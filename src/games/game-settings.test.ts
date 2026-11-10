import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-game-settings-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");

let configuredWin: typeof import("./game-settings.js").configuredWin;
let getGameSettings: typeof import("./game-settings.js").getGameSettings;
let saveGameSettings: typeof import("./game-settings.js").saveGameSettings;
let db: typeof import("../db.js").db;

beforeAll(async () => {
  ({ configuredWin, getGameSettings, saveGameSettings } = await import(
    "./game-settings.js"
  ));
  ({ db } = await import("../db.js"));
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("configured game win rate", () => {
  it("honors the absolute zero and one-hundred percent settings", () => {
    expect(configuredWin(0)).toBe(false);
    expect(configuredWin(100)).toBe(true);
  });

  it("persists the shared jackpot amount and rate", () => {
    saveGameSettings({
      taiXiuWinRate: 45,
      marketWinRate: 55,
      jackpotRate: 3,
      jackpotAmount: "9000000",
      wipeoutRate: 4,
    });
    expect(getGameSettings()).toEqual({
      taiXiuWinRate: 45,
      marketWinRate: 55,
      jackpotRate: 3,
      jackpotAmount: "9000000",
      wipeoutRate: 4,
    });
  });
});
