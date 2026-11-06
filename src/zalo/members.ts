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
 * Builds one stored member per member-list ID.
 *
 * The member-list UID (memVerList/memberIds/currentMems/owner/deputies, the
 * same UID Zalo puts in uidFrom and mentions) is always the canonical ID and
 * two member-list IDs are never merged. Extra IDs from a profile (profile.id,
 * globalId…) become aliases only when exactly one member owns them: Zalo can
 * return the same globalId/id for many members, and trusting it would collapse
 * the whole group into one person and leak the admin role.
 */
export function normalizeGroupMembers(
  info: any,
  fetchedProfiles: any[],
): { members: StoredGroupMember[]; aliases: MemberAlias[]; ambiguousIds: string[] } {
  const listIds = extractGroupMemberIds(info);
  const current = Array.isArray(info?.currentMems) ? info.currentMems : [];

  const profileByKey = new Map<string, any>();
  for (const profile of current) {
    const key = usableId(profile?.id);
    if (key && !profileByKey.has(key)) profileByKey.set(key, profile);
  }
  for (const profile of fetchedProfiles) {
    const key = usableId(profile?.__lookupId) || usableId(profile?.id);
    if (key) profileByKey.set(key, { ...profileByKey.get(key), ...profile });
  }

  const keys = [...new Set([
    ...listIds,
    ...fetchedProfiles.map((profile: any) =>
      usableId(profile?.__lookupId) || usableId(profile?.id)),
  ].filter(Boolean))];
  const keySet = new Set(keys);

  // Extra IDs claimed by each member key.
  const owners = new Map<string, Set<string>>();
  const extrasOf = (key: string) => {
    const profile = profileByKey.get(key);
    if (!profile) return [];
    return [profile.id, profile.uid, profile.userId, profile.globalId]
      .map(usableId)
      .filter((id) => id && id !== key);
  };
  for (const key of keys)
    for (const extra of extrasOf(key)) {
      const set = owners.get(extra) ?? new Set<string>();
      set.add(key);
      owners.set(extra, set);
    }
  const ambiguous = new Set<string>();
  const aliasOwner = new Map<string, string>();
  for (const [extra, set] of owners) {
    // An extra ID is trusted only if one member owns it, and it is not itself
    // the member-list ID of someone else.
    const owner = [...set][0]!;
    if (set.size === 1 && (!keySet.has(extra) || !isNumericZaloId(extra)))
      aliasOwner.set(extra, owner);
    else ambiguous.add(extra);
  }

  const adminIds = new Set(extractGroupAdminIds(info));
  const members: StoredGroupMember[] = [];
  const aliases: MemberAlias[] = [];
  for (const key of keys) {
    // A non-numeric list ID (e.g. a link member listed by globalId) that
    // belongs to a numeric member is that member, not a new person.
    const owner = aliasOwner.get(key);
    if (owner && owner !== key && !isNumericZaloId(key)) continue;
    const own = [key, ...[...aliasOwner].filter(([, o]) => o === key).map(([extra]) => extra)];
    const profiles = own.map((id) => profileByKey.get(id)).filter(Boolean);
    const profile =
      profiles.find((item) => item.displayName || item.dName || item.zaloName) ??
      profiles[0];
    const member: StoredGroupMember = {
      id: key,
      name:
        profile?.displayName ||
        profile?.dName ||
        profile?.zaloName ||
        `Zalo ${key}`,
      avatar: profile?.avatar || undefined,
      role: own.some((id) => adminIds.has(id)) ? "admin" : "member",
    };
    members.push(member);
    for (const aliasId of own) aliases.push({ aliasId, zaloId: key });
  }

  return { members, aliases, ambiguousIds: [...ambiguous] };
}
