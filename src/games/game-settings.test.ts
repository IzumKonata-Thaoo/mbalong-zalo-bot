import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-game-settings-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");

let configuredWin: typeof import("./game-settings.js").configuredWin;
let db: typeof import("../db.js").db;

beforeAll(async () => {
  ({ configuredWin } = await import("./game-settings.js"));
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
});
