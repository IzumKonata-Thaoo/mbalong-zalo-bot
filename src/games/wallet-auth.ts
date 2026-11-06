export function hasWalletAdminPermission(
  senderId: string,
  configuredAdminIds: ReadonlySet<string>,
  groupRole?: string,
): boolean {
  const normalizedId = senderId.trim();
  return configuredAdminIds.has(normalizedId) || groupRole === "admin";
}
