/**
 * A sender is a wallet admin when any of their Zalo identities (message UID,
 * group-list UID, profile id or globalId) is configured in ZALO_ADMIN_IDS or
 * is an owner/deputy ID reported live by Zalo for this group.
 */
export function hasWalletAdminPermission(
  senderIds: Iterable<string>,
  configuredAdminIds: ReadonlySet<string>,
  groupAdminIds: ReadonlySet<string> = new Set(),
  storedRole?: string,
): boolean {
  if (storedRole === "admin") return true;
  for (const raw of senderIds) {
    const id = String(raw ?? "").trim();
    if (id && (configuredAdminIds.has(id) || groupAdminIds.has(id))) return true;
  }
  return false;
}
