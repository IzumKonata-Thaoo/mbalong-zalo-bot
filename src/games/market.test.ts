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
  it("settles pnl into the same wallet used by tai xiu", async () => {
    repository.adjustWalletBalance("user-1", 10_000n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "user-1",
      senderName: "Trader",
      side: "long",
      stake: 5_000n,
      leverage: 10,
      now: Date.now() - 10_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const settled = await market.settleMarketPosition(opened.position);
    expect(repository.walletBalance("user-1")).toBe(10_000n + settled.pnl);
    expect(settled.balance).toBe(repository.walletBalance("user-1"));
  });

  it("credits a winning long/short result to the user's wallet", async () => {
    repository.setSettings({ "games.market_win_rate": "100" });
    repository.adjustWalletBalance("winner", 20_000n);
    const opened = market.openMarketPosition({
      groupId: "g-market",
      senderId: "winner",
      senderName: "Winner",
      side: "short",
      stake: 10_000n,
      leverage: 20,
      now: Date.now() - 10_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const settled = await market.settleMarketPosition(opened.position);
    expect(settled.pnl).toBeGreaterThan(0n);
    expect(repository.walletBalance("winner")).toBe(20_000n + settled.pnl);
    expect(repository.gameLeaderboard().find((row) => row.zalo_id === "winner"))
      .toMatchObject({ games_played: 1, games_won: 1 });
  });

  it("does not append the virtual-market disclaimer to a result", () => {
    const message = market.marketResultMessage({
      id: "position-1",
      groupId: "g-market",
      senderId: "user-1",
      senderName: "Trader",
      side: "long",
      stake: 5_000n,
      leverage: 10,
      entryPrice: 2_650,
      openedAt: 1_000,
      settleAt: 7_000,
      market: market.currentVirtualMarket("g-market", 1_000),
      exitPrice: 2_651,
      pnl: 18n,
      balance: 10_018n,
    });

    expect(message).not.toContain("Thị trường ảo");
    expect(message).not.toContain("Không phải giao dịch thật");
  });
});
