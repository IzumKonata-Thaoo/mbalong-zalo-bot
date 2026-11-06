export interface StoredGroupMember {
  id: string;
  name: string;
  avatar?: string;
  role: "admin" | "member";
}

export interface MemberAlias {
  aliasId: string;
  zaloId: string;
}

type GroupProfilesResponse = { profiles?: Record<string, any> };

interface GroupLinkApi {
  getGroupLinkDetail(groupId: string): Promise<{ enabled?: number | boolean | string; link?: string }>;
  getGroupLinkInfo(payload: { link: string; memberPage?: number }): Promise<{
    creatorId?: string;
    adminIds?: string[];
    admins?: any[];
    currentMems?: any[];
    hasMoreMember?: number;
    totalMember?: number;
  }>;
}

export interface LinkedGroupSnapshot {
  linkEnabled: boolean;
  pages: number;
  members: any[];
  creatorId: string;
  adminIds: string[];
  admins: any[];
  totalMember: number;
  error?: string;
}

export function emptyLinkedSnapshot(error?: string): LinkedGroupSnapshot {
  return {
    linkEnabled: false,
    pages: 0,
    members: [],
    creatorId: "",
    adminIds: [],
    admins: [],
    totalMember: 0,
    ...(error ? { error } : {}),
  };
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return code === undefined ? error.message : `${error.message} (code ${String(code)})`;
  }
  return String(error);
}

/**
 * Reads the group through its join link. Zalo exposes owner/deputy IDs and
 * paginated member pages here even when getGroupInfo only returns a subset.
 */
export async function fetchLinkedGroupSnapshot(
  groupId: string,
  api: GroupLinkApi,
  allMemberPages = true,
): Promise<LinkedGroupSnapshot> {
  const detail = await api.getGroupLinkDetail(groupId);
  const enabled = detail?.enabled;
  if (!detail?.link || (enabled !== undefined && enabled !== null && Number(enabled) !== 1))
    return emptyLinkedSnapshot();

  const members = new Map<string, any>();
  const adminIds = new Set<string>();
  const admins: any[] = [];
  let creatorId = "";
  let totalMember = 0;
  let pages = 0;
  let error: string | undefined;
  for (let memberPage = 1; memberPage <= 100; memberPage++) {
    let page: Awaited<ReturnType<GroupLinkApi["getGroupLinkInfo"]>>;
    try {
      page = await api.getGroupLinkInfo({ link: detail.link, memberPage });
    } catch (pageError) {
      if (memberPage === 1) throw pageError;
      error = `Trang thành viên ${memberPage}: ${errorText(pageError)}`;
      break;
    }
    pages = memberPage;
    creatorId ||= usableId(page?.creatorId);
    for (const id of page?.adminIds ?? []) {
      const normalized = usableId(id);
      if (normalized) adminIds.add(normalized);
    }
    if (Array.isArray(page?.admins)) admins.push(...page.admins);
    const before = members.size;
    for (const member of page?.currentMems ?? []) {
      const id = usableId(member?.id);
      if (id) members.set(id, member);
    }
    totalMember = Math.max(totalMember, Number(page?.totalMember ?? 0));
    if (!allMemberPages || !page?.hasMoreMember ||
      (totalMember > 0 && members.size >= totalMember)) break;
    if (members.size === before) break;
  }
  return {
    linkEnabled: true,
    pages,
    members: [...members.values()],
    creatorId,
    adminIds: [...adminIds],
    admins,
    totalMember,
    ...(error ? { error } : {}),
  };
}

export async function fetchLinkedGroupMembers(
  groupId: string,
  api: GroupLinkApi,
): Promise<any[]> {
  return (await fetchLinkedGroupSnapshot(groupId, api, true)).members;
}

function isInvalidParameterError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && Number((error as { code?: unknown }).code) === 114;
}

export async function fetchGroupMemberProfiles(
  memberIds: string[],
  fetchProfiles: (ids: string[]) => Promise<GroupProfilesResponse>,
  batchSize = 20,
): Promise<any[]> {
  const ids = [...new Set(memberIds.map((id) => id.trim()).filter(Boolean))];

  const fetchResilient = async (batch: string[]): Promise<any[]> => {
    if (!batch.length) return [];
    try {
      const result = await fetchProfiles(batch);
      return Object.entries(result?.profiles ?? {}).map(
        ([lookupId, profile]) => ({
          ...(profile && typeof profile === "object" ? profile : {}),
          __lookupId: lookupId,
        }),
      );
    } catch (error) {
      if (!isInvalidParameterError(error)) throw error;
      if (batch.length === 1) return [];
      const middle = Math.ceil(batch.length / 2);
      return [
        ...(await fetchResilient(batch.slice(0, middle))),
        ...(await fetchResilient(batch.slice(middle))),
      ];
    }
  };

  const profiles: any[] = [];
  for (let offset = 0; offset < ids.length; offset += batchSize)
    profiles.push(...await fetchResilient(ids.slice(offset, offset + batchSize)));
  return profiles;
}

export function usableId(value: unknown): string {
  const raw = String(value ?? "").trim();
  const versioned = raw.match(/^(\d+)_\d+$/);
  const id = versioned?.[1] ?? raw;
  return id && id !== "0" && id !== "-1" && id !== "undefined" && id !== "null" ? id : "";
}

export function isNumericZaloId(id: string) {
  return /^\d{5,}$/.test(id);
}

function idsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) =>
    item && typeof item === "object"
      ? [item.id, item.uid, item.userId, item.memberId]
      : [item]
  ).map(usableId).filter(Boolean);
}

/** Every owner/deputy ID that a Zalo group payload exposes. */
export function extractGroupAdminIds(info: any): string[] {
  return [...new Set([
    usableId(info?.creatorId),
    ...idsOf(info?.adminIds),
    ...(Array.isArray(info?.admins) ? info.admins : []).flatMap((admin: any) =>
      admin && typeof admin === "object"
        ? [admin.id, admin.uid, admin.userId, admin.zaloId, admin.globalId]
        : [admin]
    ).map(usableId),
  ].filter(Boolean))];
}

/** Every member ID a Zalo group payload exposes (owner and deputies included). */
export function extractGroupMemberIds(info: any): string[] {
  return [...new Set([
    ...idsOf(info?.memberIds),
    ...idsOf(info?.memVerList),
    ...idsOf(info?.currentMems),
    ...idsOf(info?.updateMems),
    ...extractGroupAdminIds(info),
  ])];
}

/** Short description of the member-bearing fields, for sync diagnostics. */
export function describeGroupInfo(info: any) {
  const len = (value: unknown) => (Array.isArray(value) ? value.length : "∅");
  return `memberIds=${len(info?.memberIds)} memVerList=${len(info?.memVerList)} ` +
    `currentMems=${len(info?.currentMems)} updateMems=${len(info?.updateMems)} ` +
    `adminIds=${len(info?.adminIds)} creator=${info?.creatorId ? "có" : "∅"} ` +
    `hasMoreMember=${String(info?.hasMoreMember ?? "∅")} totalMember=${String(info?.totalMember ?? "∅")}`;
}

/**
 * Groups every ID Zalo uses for the same person (member-list UID, profile
 * lookup key, profile id, globalId) and stores one member per person.
 *
 * The canonical ID is the numeric UID Zalo uses in group messages, mentions,
 * kick/add calls and `/nap ZALO_ID`; alphanumeric globalIds are kept as aliases.
 */
export function normalizeGroupMembers(
  info: any,
  fetchedProfiles: any[],
): { members: StoredGroupMember[]; aliases: MemberAlias[] } {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (cursor !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const add = (id: string) => {
    if (!parent.has(id)) parent.set(id, id);
  };
  const union = (a: string, b: string) => {
    add(a);
    add(b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const current = Array.isArray(info?.currentMems) ? info.currentMems : [];
  const profiles = [...current, ...fetchedProfiles];
  const profilesById = new Map<string, any[]>();
  for (const profile of profiles) {
    if (!profile || typeof profile !== "object") continue;
    const ids = [
      profile.__lookupId,
      profile.id,
      profile.uid,
      profile.userId,
      profile.globalId,
    ].map(usableId).filter(Boolean);
    if (!ids.length) continue;
    for (const id of ids) {
      add(id);
      union(ids[0]!, id);
      const list = profilesById.get(id) ?? [];
      list.push(profile);
      profilesById.set(id, list);
    }
  }

  const primaryIds = extractGroupMemberIds(info);
  const primary = new Set(primaryIds);
  const order = [
    ...primaryIds,
    ...fetchedProfiles.map((profile: any) => usableId(profile?.__lookupId)),
    ...fetchedProfiles.map((profile: any) => usableId(profile?.id)),
  ].filter(Boolean);
  order.forEach(add);

  const adminIds = new Set(extractGroupAdminIds(info));
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }

  const members: StoredGroupMember[] = [];
  const aliases: MemberAlias[] = [];
  const emitted = new Set<string>();
  for (const id of order) {
    const root = find(id);
    if (emitted.has(root)) continue;
    emitted.add(root);
    const ids = groups.get(root) ?? [id];
    const canonicalId =
      ids.find((candidate) => primary.has(candidate) && isNumericZaloId(candidate)) ??
      ids.find((candidate) => isNumericZaloId(candidate)) ??
      ids.find((candidate) => primary.has(candidate)) ??
      id;
    const candidates = ids.flatMap((candidate) => profilesById.get(candidate) ?? []);
    const profile =
      candidates.find((item) => item.displayName || item.dName || item.zaloName) ??
      candidates[0];
    members.push({
      id: canonicalId,
      name:
        profile?.displayName ||
        profile?.dName ||
        profile?.zaloName ||
        `Zalo ${canonicalId}`,
      avatar: profile?.avatar || undefined,
      role: ids.some((candidate) => adminIds.has(candidate)) ? "admin" : "member",
    });
    const ordered = [canonicalId, ...ids.filter((candidate) => candidate !== canonicalId)];
    for (const aliasId of ordered) aliases.push({ aliasId, zaloId: canonicalId });
  }

  return { members, aliases };
}
