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
      leverage: 20,
    });
    expect(parseMarketCommand("/short 5000 x10")).toEqual({
      kind: "position",
      side: "short",
      stake: 5000n,
      leverage: 10,
    });
  });

  it("rejects unsupported leverage and malformed position commands", () => {
    expect(parseMarketCommand("/long 10000 13x")).toEqual({ kind: "invalid" });
    expect(parseMarketCommand("/short 10000")).toEqual({ kind: "invalid" });
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
    expect(calculateLeveragedPnl(10_000n, 10, "long", 265_000, 267_650)).toBe(1_000n);
    expect(calculateLeveragedPnl(10_000n, 10, "short", 265_000, 267_650)).toBe(-1_000n);
    expect(calculateLeveragedPnl(10_000n, 100, "long", 265_000, 250_000)).toBe(-10_000n);
  });
});
