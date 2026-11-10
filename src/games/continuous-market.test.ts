import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-continuous-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");

let repository: typeof import("../db.js").repository;
let db: typeof import("../db.js").db;
let continuous: typeof import("./continuous-market.js");
let marketRules: typeof import("./market-rules.js");

beforeAll(async () => {
  ({ repository, db } = await import("../db.js"));
  continuous = await import("./continuous-market.js");
  marketRules = await import("./market-rules.js");
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("continuous market wallet", () => {
  it("accepts 1000x and rejects leverage above the /choicho limit", () => {
    expect(
      continuous.parseContinuousMarketCommand("/choicho btc long 1000x"),
    ).toMatchObject({ kind: "open", leverage: 1000n });
    expect(
      continuous.parseContinuousMarketCommand("/choicho btc long 1001x"),
    ).toEqual({ kind: "invalid" });
  });

  it("adds, subtracts and caps continuous PnL directly in the wallet", () => {
    repository.adjustWalletBalance("wallet-player", 10_000n);
    expect(
      continuous.applyContinuousWalletPnl("wallet-player", 2_500n),
    ).toMatchObject({ pnl: 2_500n, balance: 12_500n });
    expect(
      continuous.applyContinuousWalletPnl("wallet-player", -3_000n),
    ).toMatchObject({ pnl: -3_000n, balance: 9_500n });
    expect(
      continuous.applyContinuousWalletPnl("wallet-player", -99_999n),
    ).toMatchObject({ pnl: -9_500n, balance: 0n });
    expect(repository.walletBalance("wallet-player")).toBe(0n);
  });

  it("stops its timer after the user closes the position", async () => {
    repository.adjustWalletBalance("close-player", 10_000n);
    const opened = continuous.openContinuousPosition({
      groupId: "g-continuous",
      senderId: "close-player",
      senderName: "Close Player",
      symbol: "btc",
      side: "long",
      leverage: 10n,
      notify: async () => {},
    });
    expect(opened.ok).toBe(true);
    expect(continuous.closeContinuousPosition("close-player")).toContain(
      "ĐÃ CHỐT LỆNH",
    );
    const balanceAfterClose = repository.walletBalance("close-player");
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(repository.walletBalance("close-player")).toBe(balanceAfterClose);
    expect(continuous.continuousPositionStatus("close-player")).toContain(
      "chưa có vị thế",
    );
  });

  it("alerts each crossed balance milestone only once", () => {
    const alerted = new Set<string>();
    expect(
      continuous.detectBalanceMilestone(10_000n, 4_900n, alerted),
    ).toEqual({ direction: "loss", level: 50n });
    expect(
      continuous.detectBalanceMilestone(10_000n, 4_900n, alerted),
    ).toBeNull();
    expect(
      continuous.detectBalanceMilestone(10_000n, 20_000n, alerted),
    ).toEqual({ direction: "profit", level: 200n });
  });

  it("creates independent price paths for XAU, BTC and ETH", () => {
    const now = Date.UTC(2026, 10, 10, 10, 0, 0);
    const xau = marketRules.createVirtualMarket("g-markets", now, "xau");
    const btc = marketRules.createVirtualMarket("g-markets", now, "btc");
    const eth = marketRules.createVirtualMarket("g-markets", now, "eth");
    expect([xau.symbol, btc.symbol, eth.symbol]).toEqual(["xau", "btc", "eth"]);
    expect(xau.prices).not.toEqual(btc.prices);
    expect(xau.prices).not.toEqual(eth.prices);
    expect(btc.prices).not.toEqual(eth.prices);
  });
});
