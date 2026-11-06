import { describe, expect, it } from "vitest";
import { hasWalletAdminPermission } from "./wallet-auth.js";

describe("wallet admin authorization", () => {
  it("allows an explicitly configured Zalo UID", () => {
    expect(hasWalletAdminPermission(["1001"], new Set(["1001"]))).toBe(true);
  });

  it("allows a configured numeric UID even when the member is stored under a globalId", () => {
    expect(
      hasWalletAdminPermission(
        ["NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00", "1001"],
        new Set(["1001"]),
      ),
    ).toBe(true);
  });

  it("allows the live group owner/deputy without any synced member list", () => {
    expect(
      hasWalletAdminPermission(["2002"], new Set(), new Set(["9999", "2002"])),
    ).toBe(true);
  });

  it("allows a stored admin role", () => {
    expect(hasWalletAdminPermission(["2002"], new Set(), new Set(), "admin")).toBe(true);
  });

  it("rejects an ordinary unconfigured member", () => {
    expect(
      hasWalletAdminPermission(["3003"], new Set(), new Set(["2002"]), "member"),
    ).toBe(false);
  });
});
