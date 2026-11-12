import { describe, expect, it } from "vitest";
import {
  battleScore,
  chickenPower,
  parseChickenCommand,
  upgradeCost,
} from "./chicken-rules.js";

describe("chicken game rules", () => {
  it("parses raising, upgrades, PK and reply commands", () => {
    expect(parseChickenCommand("/nuoiga Hắc Kê")).toEqual({ kind: "create", name: "Hắc Kê" });
    expect(parseChickenCommand("/ga")).toEqual({ kind: "view" });
    expect(parseChickenCommand("/nangga")).toEqual({ kind: "upgrade" });
    expect(parseChickenCommand("/pk @Lan 1 tỷ tỷ")).toEqual({ kind: "challenge", stake: 10n ** 18n });
    expect(parseChickenCommand("/pk @Lan 1tỷ")).toEqual({ kind: "challenge", stake: 1_000_000_000n });
    expect(parseChickenCommand("/pk @Lan allin")).toEqual({ kind: "challenge", stake: "allin" });
    expect(parseChickenCommand("/y")).toEqual({ kind: "accept" });
    expect(parseChickenCommand("/tuchoi")).toEqual({ kind: "decline" });
  });

  it("starts upgrades at one billion and reaches repeated billions", () => {
    expect(upgradeCost(1)).toBe(10n ** 9n);
    expect(upgradeCost(4)).toBe(10n ** 18n);
    expect(upgradeCost(7)).toBe(10n ** 27n);
  });

  it("uses combat stats as the base with a luck multiplier", () => {
    const chicken = { level: 2, aggression: 20, claws: 30, comb: 15, kick_power: 40 };
    expect(chickenPower(chicken)).toBe(385);
    expect(battleScore(chicken, 85)).toBe(327);
    expect(battleScore(chicken, 115)).toBe(443);
  });

  it("adds equipped claw power to both displayed and battle power", () => {
    const chicken = { level: 2, aggression: 10, claws: 10, comb: 10, kick_power: 10 };
    expect(chickenPower(chicken, 500)).toBe(chickenPower(chicken) + 500);
    expect(battleScore(chicken, 100, 500)).toBe(chickenPower(chicken) + 500);
  });
});
