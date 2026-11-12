import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-chicken-api-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "z".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");
process.env.PUBLIC_ORIGIN = "http://localhost:8787";

let repository: typeof import("../db.js").repository;
let db: typeof import("../db.js").db;
let server: Server;
let origin: string;

const token = "api-token-123456789012345678901234";

beforeAll(async () => {
  ({ repository, db } = await import("../db.js"));
  const { createServer } = await import("./server.js");
  repository.createChicken({
    zaloId: "api-user",
    name: "API Kê",
    aggression: 20,
    claws: 20,
    comb: 20,
    kickPower: 20,
  });
  repository.ensureChickenWebProfile("api-user", token);
  repository.adjustWalletBalance("api-user", 2_000_000_000n);
  server = createServer().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind TCP");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("chicken garage API", () => {
  it("claims a PIN, requires the cookie, and atomically buys from the shared wallet", async () => {
    const status = await fetch(`${origin}/api/chicken/${token}/status`).then((response) => response.json());
    expect(status).toMatchObject({ valid: true, pinConfigured: false, chickenName: "API Kê" });

    const setup = await fetch(`${origin}/api/chicken/${token}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "2608" }),
    });
    expect(setup.status).toBe(200);
    const cookie = setup.headers.get("set-cookie")?.match(/chicken_session=([^;]+)/)?.[1];
    expect(cookie).toBeTruthy();

    expect((await fetch(`${origin}/api/chicken/${token}/garage`)).status).toBe(401);
    const headers = { cookie: `chicken_session=${cookie}` };
    const garage = await fetch(`${origin}/api/chicken/${token}/garage`, { headers }).then((response) => response.json());
    expect(garage).toMatchObject({ balance: "2000000000", equippedItem: "bare" });
    expect(garage.items).toHaveLength(7);

    const purchase = await fetch(`${origin}/api/chicken/${token}/equipment/iron`, {
      method: "POST",
      headers,
    });
    expect(purchase.status).toBe(200);
    const purchased = await purchase.json();
    expect(purchased).toMatchObject({ balance: "1000000000", equippedItem: "iron" });
    expect(purchased.items.find((item: { id: string }) => item.id === "iron")).toMatchObject({ owned: true, equipped: true });
    expect(repository.walletBalance("api-user")).toBe(1_000_000_000n);

    const equipAgain = await fetch(`${origin}/api/chicken/${token}/equipment/iron`, {
      method: "POST",
      headers,
    }).then((response) => response.json());
    expect(equipAgain.balance).toBe("1000000000");
    expect(repository.walletBalance("api-user")).toBe(1_000_000_000n);
  });
});
