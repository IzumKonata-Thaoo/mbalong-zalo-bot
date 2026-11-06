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

function usableId(value: unknown): string {
  const id = String(value ?? "").trim();
  return id && id !== "0" && id !== "undefined" && id !== "null" ? id : "";
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
    ...(Array.isArray(info?.memberIds) ? info.memberIds : []),
    ...current.map((member: any) => member?.id),
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
