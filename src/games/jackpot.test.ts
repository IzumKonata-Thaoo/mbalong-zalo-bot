import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-jackpot-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");

let resolveJackpot: typeof import("./jackpot.js").resolveJackpot;
let db: typeof import("../db.js").db;

beforeAll(async () => {
  ({ resolveJackpot } = await import("./jackpot.js"));
  ({ db } = await import("../db.js"));
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("shared jackpot", () => {
  it("uses the configured jackpot amount when it covers the normal win", () => {
    expect(
      resolveJackpot(500n, { jackpotRate: 100, jackpotAmount: "1000" }),
    ).toEqual({ hit: true, normalProfit: 500n, profit: 1000n });
  });

  it("doubles the normal win when the configured jackpot is smaller", () => {
    expect(
      resolveJackpot(1000n, { jackpotRate: 100, jackpotAmount: "500" }),
    ).toEqual({ hit: true, normalProfit: 1000n, profit: 2000n });
  });

  it("does not alter the profit when the rate is zero", () => {
    expect(
      resolveJackpot(1000n, { jackpotRate: 0, jackpotAmount: "999999" }),
    ).toEqual({ hit: false, normalProfit: 1000n, profit: 1000n });
  });
});
