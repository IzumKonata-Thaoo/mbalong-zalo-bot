import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-leaderboard-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");

let repository: typeof import("../db.js").repository;
let db: typeof import("../db.js").db;
let leaderboardMessage: typeof import("./leaderboard.js").leaderboardMessage;

beforeAll(async () => {
  ({ repository, db } = await import("../db.js"));
  ({ leaderboardMessage } = await import("./leaderboard.js"));
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("combined game leaderboard", () => {
  it("combines tai xiu and market winnings but excludes wallet top-ups", () => {
    repository.adjustWalletBalance("u1", 10_000n);
    repository.settleTaiXiu("u1", 1_000n, true, "Long");
    repository.settleMarketGame("u1", 500n, "Long");
    repository.adjustWalletBalance("u2", 1_000_000n);

    const rows = repository.gameLeaderboard();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      zalo_id: "u1",
      display_name: "Long",
      total_winnings: "1500",
      net_profit: "1500",
      games_played: 2,
      games_won: 2,
    });
    expect(leaderboardMessage()).toContain("Tổng thắng: 1.500");
  });
});
