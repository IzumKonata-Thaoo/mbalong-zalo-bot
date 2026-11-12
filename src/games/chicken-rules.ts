import { amountAtEnd, type AmountExpression } from "./amount.js";

export type ChickenCommand =
  | { kind: "help" }
  | { kind: "create"; name?: string }
  | { kind: "view" }
  | { kind: "rename"; name: string }
  | { kind: "upgrade" }
  | { kind: "challenge"; stake: AmountExpression }
  | { kind: "accept" }
  | { kind: "decline" }
  | { kind: "invalid" };

export const chickenGuide = [
  "🐓 TRẠI GÀ CHIẾN · MBALONG",
  "",
  "• @MbaLong /nuoiga [tên] — nhận gà lần đầu",
  "• @MbaLong /ga — xem ảnh và chỉ số gà",
  "• @MbaLong /datten Tên mới — đổi tên gà",
  "• @MbaLong /nangga — nâng level bằng số dư",
  "• @MbaLong /pk @ĐốiThủ 1tỷ — gạ kèo trong 5 phút",
  "• @MbaLong /pk @ĐốiThủ allin — cược toàn bộ số dư",
  "• Reply kèo bằng /y để nhận hoặc /tuchoi để từ chối",
  "",
  "Tiền cược hỗ trợ: 500k, 2tr, 1,5tỷ, allin, 1 tỷ tỷ…",
].join("\n");

export function parseChickenCommand(input: string): ChickenCommand | null {
  const text = input.trim();
  if (/^\/y\s*$/i.test(text)) return { kind: "accept" };
  if (/^\/tuchoi\s*$/i.test(text)) return { kind: "decline" };
  if (/^\/ga\s*$/i.test(text)) return { kind: "view" };
  if (/^\/nangga\s*$/i.test(text)) return { kind: "upgrade" };
  if (/^\/nuoiga(?:\s+.*)?$/i.test(text)) {
    const name = text.replace(/^\/nuoiga\s*/i, "").trim();
    return name.length > 30 ? { kind: "invalid" } : { kind: "create", ...(name ? { name } : {}) };
  }
  if (/^\/datten\b/i.test(text)) {
    const name = text.replace(/^\/datten\s*/i, "").trim();
    return !name || name.length > 30 ? { kind: "invalid" } : { kind: "rename", name };
  }
  if (/^\/pk(?:\s|$)/i.test(text)) {
    const stake = amountAtEnd(text);
    return stake ? { kind: "challenge", stake } : { kind: "invalid" };
  }
  if (/^\/(?:nuoiga|datten|nangga|pk)\b/i.test(text)) return { kind: "invalid" };
  if (/^\/gamega\s*$/i.test(text)) return { kind: "help" };
  return null;
}

export function upgradeCost(level: number) {
  return 1_000_000_000n * 1_000n ** BigInt(Math.max(0, level - 1));
}

export function chickenPower(chicken: {
  level: number;
  aggression: number;
  claws: number;
  comb: number;
  kick_power: number;
}, equipmentPowerBonus = 0) {
  return (
    chicken.kick_power * 5 +
    chicken.claws * 3 +
    chicken.aggression * 2 +
    chicken.comb +
    chicken.level * 20 + equipmentPowerBonus
  );
}

export function battleScore(
  chicken: Parameters<typeof chickenPower>[0],
  luckPercent: number,
  equipmentPowerBonus = 0,
) {
  return Math.max(1, Math.round(chickenPower(chicken, equipmentPowerBonus) * luckPercent / 100));
}
