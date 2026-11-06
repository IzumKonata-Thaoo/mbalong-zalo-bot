export type TaiXiuChoice = "tai" | "xiu";
export type TaiXiuCommand =
  | { kind: "help" }
  | { kind: "bet"; choice: TaiXiuChoice; amount: bigint }
  | { kind: "invalid" };

export function parseTaiXiu(input: string): TaiXiuCommand | null {
  const text = input.trim().toLowerCase();
  if (!text.startsWith("/tx")) return null;
  if (text === "/tx") return { kind: "help" };
  const match = text.match(/^\/tx\s+(tài|tai|xỉu|xiu)\s+([1-9]\d*)$/i);
  if (!match) return { kind: "invalid" };
  return {
    kind: "bet",
    choice: /^(tài|tai)$/i.test(match[1]!) ? "tai" : "xiu",
    amount: BigInt(match[2]!),
  };
}

export function resolveTaiXiu(
  dice: [number, number, number],
): TaiXiuChoice | "triple" {
  if (dice[0] === dice[1] && dice[1] === dice[2]) return "triple";
  return dice[0] + dice[1] + dice[2] >= 11 ? "tai" : "xiu";
}

export function formatBetAmount(amount: bigint): string {
  const units = [
    { value: 1_000_000_000_000_000_000n, name: "tỷ tỷ" },
    { value: 1_000_000_000_000_000n, name: "triệu tỷ" },
    { value: 1_000_000_000_000n, name: "nghìn tỷ" },
    { value: 1_000_000_000n, name: "tỷ" },
    { value: 1_000_000n, name: "triệu" },
  ];
  const unit = units.find((candidate) => amount >= candidate.value);
  if (!unit) return amount.toLocaleString("vi-VN");
  const whole = amount / unit.value;
  const hundredths = ((amount % unit.value) * 100n) / unit.value;
  const decimal =
    hundredths === 0n
      ? ""
      : `,` + hundredths.toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("vi-VN")}${decimal} ${unit.name}`;
}
