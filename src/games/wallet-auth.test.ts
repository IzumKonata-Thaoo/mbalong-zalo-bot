import { describe, expect, it } from "vitest";
import { hasWalletAdminPermission } from "./wallet-auth.js";

describe("wallet admin authorization", () => {
  it("allows an explicitly configured Zalo UID", () => {
    expect(
      hasWalletAdminPermission("1001", new Set(["1001"]), "member"),
    ).toBe(true);
  });

  it("allows a real group admin even when not globally configured", () => {
    expect(hasWalletAdminPermission("2002", new Set(), "admin")).toBe(true);
  });

  it("rejects an ordinary unconfigured member", () => {
    expect(hasWalletAdminPermission("3003", new Set(), "member")).toBe(false);
  });
});
