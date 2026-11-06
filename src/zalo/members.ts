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
  getGroupLinkDetail(groupId: string): Promise<{ enabled?: number; link?: string }>;
  getGroupLinkInfo(payload: { link: string; memberPage?: number }): Promise<{
    currentMems?: any[];
    hasMoreMember?: number;
    totalMember?: number;
  }>;
}

export async function fetchLinkedGroupMembers(
  groupId: string,
  api: GroupLinkApi,
): Promise<any[]> {
  const detail = await api.getGroupLinkDetail(groupId);
  if (detail?.enabled !== 1 || !detail.link) return [];

  const members = new Map<string, any>();
  for (let memberPage = 1; memberPage <= 100; memberPage++) {
    const page = await api.getGroupLinkInfo({
      link: detail.link,
      memberPage,
    });
    const before = members.size;
    for (const member of page?.currentMems ?? []) {
      const id = usableId(member?.id);
      if (id) members.set(id, member);
    }
    const total = Number(page?.totalMember ?? 0);
    if (!page?.hasMoreMember || (total > 0 && members.size >= total)) break;
    if (members.size === before) break;
  }
  return [...members.values()];
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

function usableId(value: unknown): string {
  const raw = String(value ?? "").trim();
  const versioned = raw.match(/^(\d+)_\d+$/);
  const id = versioned?.[1] ?? raw;
  return id && id !== "0" && id !== "undefined" && id !== "null" ? id : "";
}

export function extractGroupMemberIds(info: any): string[] {
  const current = Array.isArray(info?.currentMems) ? info.currentMems : [];
  return [...new Set([
    ...(Array.isArray(info?.memberIds) ? info.memberIds : []),
    ...(Array.isArray(info?.memVerList) ? info.memVerList : []),
    ...current.map((member: any) => member?.id),
  ].map(usableId).filter(Boolean))];
}

export function normalizeGroupMembers(
  info: any,
  fetchedProfiles: any[],
): { members: StoredGroupMember[]; aliases: MemberAlias[] } {
  const current = Array.isArray(info?.currentMems) ? info.currentMems : [];
  const profiles = [...current, ...fetchedProfiles];
  const byId = new Map<string, any>();
  for (const profile of profiles) {
    const id = usableId(profile?.id);
    const globalId = usableId(profile?.globalId);
    const lookupId = usableId(profile?.__lookupId);
    if (id) byId.set(id, profile);
    if (globalId) byId.set(globalId, profile);
    if (lookupId) byId.set(lookupId, profile);
  }

  const rawIds = [
    ...extractGroupMemberIds(info),
    ...fetchedProfiles.map((profile: any) => profile?.id),
    ...fetchedProfiles.map((profile: any) => profile?.__lookupId),
  ].map(usableId).filter(Boolean);
  const rawAdmins = Array.isArray(info?.admins) ? info.admins : [];
  const adminIds = new Set([
    info?.creatorId,
    ...(Array.isArray(info?.adminIds) ? info.adminIds : []),
    ...rawAdmins.flatMap((admin: any) =>
      admin && typeof admin === "object"
        ? [admin.id, admin.uid, admin.userId, admin.zaloId, admin.globalId]
        : [admin]
    ),
  ].map(usableId).filter(Boolean));
  const memberById = new Map<string, StoredGroupMember>();
  const aliasById = new Map<string, MemberAlias>();

  for (const localId of new Set(rawIds)) {
    const profile = byId.get(localId);
    const profileId = usableId(profile?.id) || localId;
    const globalId = usableId(profile?.globalId);
    const canonicalId = globalId || profileId;
    const role = [localId, profileId, globalId].some(
      (id) => id && adminIds.has(id),
    ) ? "admin" : "member";
    const existing = memberById.get(canonicalId);
    memberById.set(canonicalId, {
      id: canonicalId,
      name:
        profile?.displayName ||
        profile?.dName ||
        profile?.zaloName ||
        `Zalo ${canonicalId}`,
      avatar: profile?.avatar,
      role: existing?.role === "admin" || role === "admin" ? "admin" : "member",
    });
    for (const aliasId of [
      localId,
      usableId(profile?.__lookupId),
      profileId,
      globalId,
    ]) {
      if (aliasId)
        aliasById.set(aliasId, { aliasId, zaloId: canonicalId });
    }
  }

  return {
    members: [...memberById.values()],
    aliases: [...aliasById.values()],
  };
}
