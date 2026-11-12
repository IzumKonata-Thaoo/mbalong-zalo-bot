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
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const group = Math.floor((absolute.toString().length - 1) / 3);
  if (group < 2) return amount.toLocaleString("vi-VN");
  const unitValue = 1_000n ** BigInt(group);
  const tyCount = Math.floor(group / 3);
  const prefix = group % 3 === 1 ? "nghìn " : group % 3 === 2 ? "triệu " : "";
  const unitName = `${prefix}${Array.from({ length: tyCount }, () => "tỷ").join(" ")}`.trim();
  const whole = absolute / unitValue;
  const hundredths = ((absolute % unitValue) * 100n) / unitValue;
  const decimal =
    hundredths === 0n
      ? ""
      : `,` + hundredths.toString().padStart(2, "0").replace(/0+$/, "");
  return `${negative ? "−" : ""}${whole.toLocaleString("vi-VN")}${decimal} ${unitName}`;
}
