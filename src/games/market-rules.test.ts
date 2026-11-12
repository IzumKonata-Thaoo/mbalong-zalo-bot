import { describe, expect, it } from "vitest";
import {
  calculateLeveragedPnl,
  createVirtualMarket,
  parseMarketCommand,
} from "./market-rules.js";

describe("virtual long/short market", () => {
  it("parses market, long and short commands with explicit leverage", () => {
    expect(parseMarketCommand("/market")).toEqual({ kind: "market" });
    expect(parseMarketCommand("xem thị trường")).toEqual({ kind: "market" });
    expect(parseMarketCommand("/long 10000 20x")).toEqual({
      kind: "position",
      side: "long",
      stake: 10000n,
      leverage: 20n,
    });
    expect(parseMarketCommand("/short 5000 x10")).toEqual({
      kind: "position",
      side: "short",
      stake: 5000n,
      leverage: 10n,
    });
    expect(parseMarketCommand("/long btc 1tỷ 100x")).toEqual({
      kind: "position",
      side: "long",
      symbol: "btc",
      stake: 1_000_000_000n,
      leverage: 100n,
    });
    expect(parseMarketCommand("/short allin 10x")).toEqual({
      kind: "position",
      side: "short",
      stake: "allin",
      leverage: 10n,
    });
    expect(parseMarketCommand("/long 10000 20x 30s")).toEqual({
      kind: "position",
      side: "long",
      stake: 10000n,
      leverage: 20n,
      settleAfterMs: 30_000,
    });
    expect(parseMarketCommand("/short 5000 x10 2m")).toEqual({
      kind: "position",
      side: "short",
      stake: 5000n,
      leverage: 10n,
      settleAfterMs: 120_000,
    });
  });

  it("accepts unlimited positive leverage and rejects malformed commands", () => {
    expect(parseMarketCommand("/long 10000 999999999999999999999999x")).toEqual({
      kind: "position",
      side: "long",
      stake: 10000n,
      leverage: 999999999999999999999999n,
    });
    expect(parseMarketCommand("/short 10000")).toEqual({ kind: "invalid" });
    expect(parseMarketCommand("/long 10000 10x 4s")).toEqual({ kind: "invalid" });
    expect(parseMarketCommand("/long 10000 10x 6m")).toEqual({ kind: "invalid" });
  });

  it("keeps the same five-hour market path for every viewer in a group", () => {
    const now = Date.UTC(2026, 10, 9, 10, 15, 30);
    const first = createVirtualMarket("group-1", now);
    const second = createVirtualMarket("group-1", now + 2_000);
    expect(first.sessionStart).toBe(second.sessionStart);
    expect(first.sessionEnd - first.sessionStart).toBe(5 * 60 * 60 * 1_000);
    expect(first.prices).toEqual(second.prices);
  });

  it("calculates directional leveraged pnl and caps loss at the stake", () => {
    expect(calculateLeveragedPnl(10_000n, 10n, "long", 265_000, 267_650)).toBe(1_000n);
    expect(calculateLeveragedPnl(10_000n, 10n, "short", 265_000, 267_650)).toBe(-1_000n);
    expect(calculateLeveragedPnl(10_000n, 100n, "long", 265_000, 250_000)).toBe(-10_000n);
    expect(
      calculateLeveragedPnl(
        10_000n,
        999999999999999999999999n,
        "long",
        265_000,
        267_650,
      ),
    ).toBe(99999999999999999999999900n);
  });
});
