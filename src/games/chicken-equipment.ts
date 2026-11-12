import { formatBetAmount } from "./tai-xiu-rules.js";

export const CHICKEN_CLAW_ITEMS = [
  { id: "iron", name: "Móng Sắt", price: 1_000_000_000n, powerBonus: 120, color: "#a3a3a3", accent: "#e5e5e5" },
  { id: "tungsten", name: "Móng Vonfram", price: 1_000_000_000_000n, powerBonus: 420, color: "#737373", accent: "#d4d4d4" },
  { id: "gold", name: "Móng Hoàng Kim", price: 1_000_000_000_000_000n, powerBonus: 1_400, color: "#eab308", accent: "#fef08a" },
  { id: "meteor", name: "Móng Thiên Thạch", price: 1_000_000_000_000_000_000n, powerBonus: 4_800, color: "#f97316", accent: "#fed7aa" },
  { id: "dragon", name: "Móng Long Cốt", price: 1_000_000_000_000_000_000_000n, powerBonus: 16_000, color: "#dc2626", accent: "#fecaca" },
  { id: "diamond", name: "Móng Kim Cương", price: 1_000_000_000_000_000_000_000_000n, powerBonus: 54_000, color: "#22d3ee", accent: "#cffafe" },
  { id: "void", name: "Móng Hư Không", price: 1_000_000_000_000_000_000_000_000_000n, powerBonus: 180_000, color: "#c084fc", accent: "#f3e8ff" },
] as const;

export type ChickenClawItemId = (typeof CHICKEN_CLAW_ITEMS)[number]["id"];
export type ChickenClawItem = (typeof CHICKEN_CLAW_ITEMS)[number];

export const BARE_CLAWS = {
  id: "bare",
  name: "Móng nguyên bản",
  price: 0n,
  powerBonus: 0,
  color: "#f59e0b",
  accent: "#fde68a",
} as const;

export function chickenClawItem(id: string | null | undefined) {
  if (!id || id === BARE_CLAWS.id) return BARE_CLAWS;
  return CHICKEN_CLAW_ITEMS.find((item) => item.id === id) ?? BARE_CLAWS;
}

export function publicChickenClawItem(item: ChickenClawItem) {
  return {
    id: item.id,
    name: item.name,
    price: item.price.toString(),
    priceLabel: formatBetAmount(item.price),
    powerBonus: item.powerBonus,
    color: item.color,
    accent: item.accent,
  };
}
