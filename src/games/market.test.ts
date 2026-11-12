import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-market-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");

let repository: typeof import("../db.js").repository;
let db: typeof import("../db.js").db;
let market: typeof import("./market.js");

beforeAll(async () => {
  ({ repository, db } = await import("../db.js"));
  market = await import("./market.js");
  repository.upsertGroup("g-market", "Nhóm giao dịch", 2);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("market wallet settlement", () => {
  it("opens an all-in position with the entire live wallet", () => {
    repository.adjustWalletBalance("market-allin", 123_456n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "market-allin",
      senderName: "Market All In",
      side: "long",
      stake: "allin",
      leverage: 10n,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.position.stake).toBe(123_456n);
    market.cancelMarketPosition(opened.position);
  });

  it("keeps full winning leverage but charges one tenth on the losing side", () => {
    expect(market.calculateFixedMarketPnl(1_000n, 1_000n, true)).toBe(1_000_000n);
    expect(market.calculateFixedMarketPnl(1_000n, 1_000n, false)).toBe(-100_000n);
    expect(market.calculateFixedMarketPnl(1_000n, 100n, false)).toBe(-10_000n);
    expect(market.calculateFixedMarketPnl(1_000n, 10n, false)).toBe(-1_000n);
    expect(market.calculateFixedMarketPnl(1_000n, 20n, false)).toBe(-2_000n);
    expect(market.calculateFixedMarketPnl(1n, 1n, false)).toBe(-1n);
  });

  it("uses the close time selected in the command", () => {
    repository.adjustWalletBalance("timed-user", 10_000n);
    const now = Date.now();
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "timed-user",
      senderName: "Timed User",
      side: "long",
      stake: 1_000n,
      leverage: 10n,
      settleAfterMs: 120_000,
      now,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.position.marketCloseAt).toBe(now + 120_000);
    expect(opened.position.settleAt).toBeGreaterThanOrEqual(now + 5_000);
    expect(opened.position.settleAt).toBeLessThanOrEqual(now + 7_000);
    expect(market.marketOpenMessage(opened.position)).toContain("2 phút");
    market.cancelMarketPosition(opened.position);
  });

  it("closes immediately without a game result when the wallet reaches zero", async () => {
    repository.adjustWalletBalance("empty-wallet", 1_000n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "empty-wallet",
      senderName: "Empty Wallet",
      side: "short",
      stake: 1_000n,
      leverage: 10n,
      settleAfterMs: 300_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    repository.adjustWalletBalance("empty-wallet", -1_000n);

    const settled = await market.settleMarketPosition(opened.position);
    expect(settled.liquidated).toBe(true);
    expect(settled.pnl).toBe(0n);
    expect(market.marketResultMessage(settled)).toContain("ĐÃ ĐÓNG SỚM");
    expect(
      repository.gameLeaderboard().some((row) => row.zalo_id === "empty-wallet"),
    ).toBe(false);
  });

  it("settles pnl into the same wallet used by tai xiu", async () => {
    repository.adjustWalletBalance("user-1", 10_000n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "user-1",
      senderName: "Trader",
      side: "long",
      stake: 5_000n,
      leverage: 10n,
      now: Date.now() - 10_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const settled = await market.settleMarketPosition(opened.position);
    expect(repository.walletBalance("user-1")).toBe(10_000n + settled.pnl);
    expect(settled.balance).toBe(repository.walletBalance("user-1"));
  });

  it("credits a winning long/short result to the user's wallet", async () => {
    repository.setSettings({
      "games.market_win_rate": "100",
      "games.jackpot_rate": "0",
    });
    repository.adjustWalletBalance("winner", 20_000n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "winner",
      senderName: "Winner",
      side: "short",
      stake: 10_000n,
      leverage: 20n,
      now: Date.now() - 10_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const settled = await market.settleMarketPosition(opened.position);
    expect(settled.pnl).toBe(200_000n);
    expect(repository.walletBalance("winner")).toBe(20_000n + settled.pnl);
    expect(repository.gameLeaderboard().find((row) => row.zalo_id === "winner"))
      .toMatchObject({ games_played: 1, games_won: 1 });
  });

  it("charges one tenth of a losing 1000x position while preserving the displayed leverage", async () => {
    repository.setSettings({
      "games.market_win_rate": "0",
      "games.jackpot_rate": "0",
      "games.wipeout_rate": "0",
    });
    repository.adjustWalletBalance("leveraged-loser", 1_500_000n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "leveraged-loser",
      senderName: "Leveraged Loser",
      side: "long",
      stake: 1_000n,
      leverage: 1_000n,
      now: Date.now() - 10_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const settled = await market.settleMarketPosition(opened.position);
    expect(settled.normalPnl).toBe(-100_000n);
    expect(settled.pnl).toBe(-100_000n);
    expect(settled.leverage).toBe(1_000n);
    expect(repository.walletBalance("leveraged-loser")).toBe(1_400_000n);
  });

  it("stops a leveraged loss at zero instead of creating a negative wallet", async () => {
    repository.setSettings({
      "games.market_win_rate": "0",
      "games.jackpot_rate": "0",
      "games.wipeout_rate": "0",
    });
    repository.adjustWalletBalance("capped-loser", 50_000n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "capped-loser",
      senderName: "Capped Loser",
      side: "short",
      stake: 1_000n,
      leverage: 1_000n,
      now: Date.now() - 10_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const settled = await market.settleMarketPosition(opened.position);
    expect(settled.normalPnl).toBe(-100_000n);
    expect(settled.pnl).toBe(-50_000n);
    expect(settled.balance).toBe(0n);
    expect(repository.walletBalance("capped-loser")).toBe(0n);
  });

  it("credits double the normal market win when a smaller jackpot hits", async () => {
    repository.setSettings({
      "games.market_win_rate": "100",
      "games.jackpot_rate": "100",
      "games.jackpot_amount": "0",
    });
    repository.adjustWalletBalance("jackpot-winner", 20_000n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "jackpot-winner",
      senderName: "Jackpot Winner",
      side: "long",
      stake: 10_000n,
      leverage: 10n,
      now: Date.now() - 10_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const settled = await market.settleMarketPosition(opened.position);
    expect(settled.jackpot).toBe(true);
    expect(settled.normalPnl).toBeGreaterThan(0n);
    expect(settled.pnl).toBe(settled.normalPnl! * 2n);
    expect(repository.walletBalance("jackpot-winner")).toBe(
      20_000n + settled.pnl,
    );
    expect(market.marketResultMessage(settled)).toContain("NỔ HŨ");
  });

  it("does not append the virtual-market disclaimer to a result", () => {
    const message = market.marketResultMessage({
      id: "position-1",
      groupId: "g-market",
      senderId: "user-1",
      senderName: "Trader",
      side: "long",
      stake: 5_000n,
      leverage: 10n,
      entryPrice: 2_650,
      openedAt: 1_000,
      settleAt: 7_000,
      marketCloseAt: 7_000,
      market: market.currentVirtualMarket("g-market", 1_000),
      exitPrice: 2_651,
      pnl: 18n,
      balance: 10_018n,
    });

    expect(message).not.toContain("Thị trường ảo");
    expect(message).not.toContain("Không phải giao dịch thật");
  });
});
