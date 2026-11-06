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
      return Object.values(result?.profiles ?? {});
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
    if (id) byId.set(id, profile);
    if (globalId) byId.set(globalId, profile);
  }

  const rawIds = [
    ...extractGroupMemberIds(info),
    ...fetchedProfiles.map((profile: any) => profile?.id),
  ].map(usableId).filter(Boolean);
  const adminIds = new Set(
    (Array.isArray(info?.adminIds) ? info.adminIds : []).map(usableId),
  );
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
    memberById.set(canonicalId, {
      id: canonicalId,
      name:
        profile?.displayName ||
        profile?.dName ||
        profile?.zaloName ||
        `Zalo ${canonicalId}`,
      avatar: profile?.avatar,
      role,
    });
    for (const aliasId of [localId, profileId, globalId]) {
      if (aliasId)
        aliasById.set(aliasId, { aliasId, zaloId: canonicalId });
    }
  }

  return {
    members: [...memberById.values()],
    aliases: [...aliasById.values()],
  };
}
