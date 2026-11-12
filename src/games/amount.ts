function normalizeWords(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .trim();
}

export type AmountExpression = bigint | "allin";

const amountSuffixPattern =
  /(?:^|\s)(all(?:\s|-)?in|\d[\d.,_]*\s*(?:(?:nghìn|nghin|ngàn|ngan|triệu|trieu|tr|m|tỷ|ty|t|b|k)(?:\s+(?:tỷ|ty|t|b))*)?)\s*$/iu;

/** Parses exact integer amounts such as 1000000, 1,5 triệu or 2 tỷ tỷ tỷ. */
export function parseVietnameseAmount(input: string): bigint | null {
  const normalized = normalizeWords(input).replace(/_/g, "");
  if (/^\d[\d.,]*$/.test(normalized)) {
    const value = BigInt(normalized.replace(/[.,]/g, ""));
    return value > 0n ? value : null;
  }
  const match = normalized.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match) return null;
  const numberPart = match[1]!;
  const unitPart = match[2]!.replace(/\s+/g, " ").trim();

  if (!unitPart) return null;

  const units = unitPart
    .split(" ")
    .filter(Boolean)
    .map((unit) => {
      if (["nghin", "ngan", "k"].includes(unit)) return "nghin";
      if (["trieu", "tr", "m"].includes(unit)) return "trieu";
      if (["ty", "t", "b"].includes(unit)) return "ty";
      return unit;
    });
  let multiplier = 1n;
  if (units.length === 1 && (units[0] === "nghin" || units[0] === "k"))
    multiplier = 1_000n;
  else if (units.length === 1 && units[0] === "trieu")
    multiplier = 1_000_000n;
  else if (units.every((unit) => unit === "ty"))
    multiplier = 1_000_000_000n ** BigInt(units.length);
  else if (
    units.length >= 2 &&
    (units[0] === "nghin" || units[0] === "trieu") &&
    units.slice(1).every((unit) => unit === "ty")
  ) {
    multiplier =
      (units[0] === "nghin" ? 1_000n : 1_000_000n) *
      1_000_000_000n ** BigInt(units.length - 1);
  } else return null;

  const [whole, fraction = ""] = numberPart.replace(",", ".").split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`);
  const scaled = numerator * multiplier;
  if (scaled % denominator !== 0n) return null;
  const value = scaled / denominator;
  return value > 0n ? value : null;
}

export function parseAmountExpression(input: string): AmountExpression | null {
  const normalized = normalizeWords(input).replace(/[\s-]/g, "");
  if (normalized === "allin") return "allin";
  return parseVietnameseAmount(input);
}

export function resolveAmountExpression(
  expression: AmountExpression,
  currentBalance: bigint,
) {
  return expression === "allin" ? currentBalance : expression;
}

export function amountExpressionAtEnd(input: string) {
  const text = input.trimEnd();
  const match = text.match(amountSuffixPattern);
  if (!match || match.index === undefined) return null;
  const raw = match[1]!;
  const amount = parseAmountExpression(raw);
  if (amount === null) return null;
  return {
    amount,
    raw,
    start: text.length - raw.length,
  };
}

export function amountAtEnd(input: string): AmountExpression | null {
  return amountExpressionAtEnd(input)?.amount ?? null;
}
