import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-tai-xiu-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");

let repository: typeof import("../db.js").repository;
let db: typeof import("../db.js").db;
let handleTaiXiu: typeof import("./tai-xiu.js").handleTaiXiu;

beforeAll(async () => {
  ({ repository, db } = await import("../db.js"));
  ({ handleTaiXiu } = await import("./tai-xiu.js"));
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("tai xiu jackpot", () => {
  it("resolves all-in to the entire live wallet balance", () => {
    repository.setSettings({
      "games.tai_xiu_win_rate": "0",
      "games.jackpot_rate": "0",
      "games.wipeout_rate": "0",
    });
    repository.adjustWalletBalance("allin-player", 12_345n);

    const response = handleTaiXiu(
      "allin-player",
      "/tx tài allin",
      "All In",
    );

    expect(response).toContain("Mức cược 12.345");
    expect(repository.walletBalance("allin-player")).toBe(0n);
  });

  it("credits the configured jackpot to the shared wallet and leaderboard", () => {
    repository.setSettings({
      "games.tai_xiu_win_rate": "100",
      "games.jackpot_rate": "100",
      "games.jackpot_amount": "1000",
    });
    repository.adjustWalletBalance("player", 10_000n);

    const response = handleTaiXiu("player", "/tx tai 100", "Người chơi");

    expect(response).toContain("NỔ HŨ");
    expect(response).toContain("Thưởng 1.000");
    expect(repository.walletBalance("player")).toBe(11_000n);
    expect(repository.gameLeaderboard()[0]).toMatchObject({
      total_winnings: "1000",
      net_profit: "1000",
      games_played: 1,
      games_won: 1,
    });
  });
});
