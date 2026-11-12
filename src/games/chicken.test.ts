import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "mbalong-chicken-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");

let repository: typeof import("../db.js").repository;
let db: typeof import("../db.js").db;
let renderChickenImage: typeof import("./chicken-image.js").renderChickenImage;
let chickenPinMatches: typeof import("../http/chicken-auth.js").chickenPinMatches;
let hashChickenPin: typeof import("../http/chicken-auth.js").hashChickenPin;

beforeAll(async () => {
  ({ repository, db } = await import("../db.js"));
  ({ renderChickenImage } = await import("./chicken-image.js"));
  ({ chickenPinMatches, hashChickenPin } = await import("../http/chicken-auth.js"));
  repository.upsertGroup("g-chicken", "Nhóm gà", 2);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createChicken(id: string, name: string) {
  return repository.createChicken({
    zaloId: id,
    name,
    aggression: 20,
    claws: 20,
    comb: 20,
    kickPower: 20,
  }).chicken;
}

describe("chicken persistence and wallet settlement", () => {
  it("atomically charges an expensive upgrade and increases every stat", () => {
    const chicken = createChicken("upgrade-user", "Kim Kê");
    repository.adjustWalletBalance("upgrade-user", 2_000_000_000n);
    const result = repository.upgradeChicken("upgrade-user", 1_000_000_000n, {
      aggression: 5,
      claws: 6,
      comb: 7,
      kickPower: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balance).toBe(1_000_000_000n);
    expect(repository.walletBalance("upgrade-user")).toBe(1_000_000_000n);
    expect(result.chicken).toMatchObject({
      level: chicken.level + 1,
      aggression: 25,
      claws: 26,
      comb: 27,
      kick_power: 28,
    });
  });

  it("takes both stakes and gives the full pot to one winner in one settlement", () => {
    createChicken("pk-a", "Gà A");
    createChicken("pk-b", "Gà B");
    repository.adjustWalletBalance("pk-a", 2_000_000_000n);
    repository.adjustWalletBalance("pk-b", 2_000_000_000n);
    const now = Date.now();
    expect(repository.createChickenChallenge({
      id: "fight-1",
      groupId: "g-chicken",
      challengerId: "pk-a",
      challengerName: "A",
      targetId: "pk-b",
      targetName: "B",
      stake: 500_000_000n,
      now,
      expiresAt: now + 300_000,
    })).toEqual({ ok: true });
    const settled = repository.settleChickenChallenge({
      id: "fight-1",
      targetId: "pk-b",
      winnerId: "pk-a",
      challengerScore: 500,
      targetScore: 450,
      now: now + 1,
    });
    expect(settled.ok).toBe(true);
    expect(repository.walletBalance("pk-a")).toBe(2_500_000_000n);
    expect(repository.walletBalance("pk-b")).toBe(1_500_000_000n);
    expect(repository.chicken("pk-a")).toMatchObject({ wins: 1, losses: 0 });
    expect(repository.chicken("pk-b")).toMatchObject({ wins: 0, losses: 1 });
    expect(repository.settleChickenChallenge({
      id: "fight-1",
      targetId: "pk-b",
      winnerId: "pk-b",
      challengerScore: 1,
      targetScore: 2,
      now: now + 2,
    })).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("changes neither wallet if the target cannot afford the accepted stake", () => {
    createChicken("poor-a", "Gà C");
    createChicken("poor-b", "Gà D");
    repository.adjustWalletBalance("poor-a", 1_000n);
    repository.adjustWalletBalance("poor-b", 100n);
    const now = Date.now();
    repository.createChickenChallenge({
      id: "fight-poor",
      groupId: "g-chicken",
      challengerId: "poor-a",
      challengerName: "C",
      targetId: "poor-b",
      targetName: "D",
      stake: 500n,
      now,
      expiresAt: now + 300_000,
    });
    const settled = repository.settleChickenChallenge({
      id: "fight-poor",
      targetId: "poor-b",
      winnerId: "poor-a",
      challengerScore: 5,
      targetScore: 4,
      now: now + 1,
    });
    expect(settled).toMatchObject({ ok: false, reason: "target_insufficient", balance: 100n });
    expect(repository.walletBalance("poor-a")).toBe(1_000n);
    expect(repository.walletBalance("poor-b")).toBe(100n);
  });

  it("renders the default chicken card as a PNG", async () => {
    const chicken = createChicken("image-user", "Lôi Kê");
    const image = await renderChickenImage(chicken, "Chủ kê");
    expect(image.subarray(1, 4).toString()).toBe("PNG");
    expect(image.length).toBeGreaterThan(10_000);
  });

  it("atomically buys and equips a claw with the same wallet used by Zalo", () => {
    createChicken("gear-user", "Thiết Kê");
    repository.ensureChickenWebProfile("gear-user", "gear-token-123456789012345678901234");
    repository.adjustWalletBalance("gear-user", 2_000_000_000n);
    const bought = repository.purchaseOrEquipChickenItem("gear-user", "iron", 1_000_000_000n);
    expect(bought).toMatchObject({ ok: true, purchased: true, balance: 1_000_000_000n, equippedItem: "iron" });
    expect(repository.walletBalance("gear-user")).toBe(1_000_000_000n);
    expect(repository.chickenOwnedItems("gear-user")).toEqual(["iron"]);
    expect(repository.chickenWebProfile("gear-user")?.equipped_item).toBe("iron");

    const equippedAgain = repository.purchaseOrEquipChickenItem("gear-user", "iron", 1_000_000_000n);
    expect(equippedAgain).toMatchObject({ ok: true, purchased: false, balance: 1_000_000_000n });
    expect(repository.walletBalance("gear-user")).toBe(1_000_000_000n);
  });

  it("changes nothing when an equipment purchase cannot be afforded", () => {
    createChicken("gear-poor", "Mộc Kê");
    repository.ensureChickenWebProfile("gear-poor", "poor-token-123456789012345678901234");
    repository.adjustWalletBalance("gear-poor", 500n);
    const result = repository.purchaseOrEquipChickenItem("gear-poor", "diamond", 1_000_000n);
    expect(result).toMatchObject({ ok: false, reason: "insufficient", balance: 500n });
    expect(repository.walletBalance("gear-poor")).toBe(500n);
    expect(repository.chickenOwnedItems("gear-poor")).toEqual([]);
    expect(repository.chickenWebProfile("gear-poor")?.equipped_item).toBe("bare");
  });

  it("sets the numeric garage PIN once and verifies only the right PIN", () => {
    createChicken("pin-user", "Khóa Kê");
    repository.ensureChickenWebProfile("pin-user", "pin-token-1234567890123456789012345");
    const secured = hashChickenPin("2608");
    expect(repository.setChickenPinIfUnset("pin-user", secured.salt, secured.hash)).toBe(true);
    expect(repository.setChickenPinIfUnset("pin-user", "other", "other")).toBe(false);
    expect(chickenPinMatches("2608", secured.salt, secured.hash)).toBe(true);
    expect(chickenPinMatches("2609", secured.salt, secured.hash)).toBe(false);
  });
});
