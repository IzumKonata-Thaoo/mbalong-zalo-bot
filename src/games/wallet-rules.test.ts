import { describe, expect, it } from "vitest";
import { parseWalletCommand } from "./wallet-rules.js";

describe("wallet commands", () => {
  it("parses self balance and self adjustments", () => {
    expect(parseWalletCommand("/sodu")).toEqual({ kind: "balance" });
    expect(parseWalletCommand("/nap 1000000")).toEqual({
      kind: "adjust",
      operation: "add",
      amount: 1_000_000n,
    });
    expect(parseWalletCommand("/tru 500")).toEqual({
      kind: "adjust",
      operation: "subtract",
      amount: 500n,
    });
  });

  it("parses an explicit Zalo ID target", () => {
    expect(parseWalletCommand("/nap 123456789 10000")).toEqual({
      kind: "adjust",
      operation: "add",
      explicitTargetId: "123456789",
      amount: 10000n,
    });
  });

  it("accepts a tagged target before the amount", () => {
    expect(parseWalletCommand("@Người dùng /nap @Người dùng 2000")).toEqual({
      kind: "adjust",
      operation: "add",
      amount: 2000n,
    });
  });

  it("parses transfers by tag or explicit Zalo ID", () => {
    expect(parseWalletCommand("@Lan /chuyen 2500")).toEqual({
      kind: "transfer",
      amount: 2500n,
    });
    expect(parseWalletCommand("/chuyen 123456789 3000")).toEqual({
      kind: "transfer",
      explicitTargetId: "123456789",
      amount: 3000n,
    });
  });
});
