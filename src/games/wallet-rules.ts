import {
  amountExpressionAtEnd,
  type AmountExpression,
} from "./amount.js";

export type WalletCommand =
  | { kind: "balance" }
  | {
      kind: "transfer";
      amount: AmountExpression;
      explicitTargetId?: string;
    }
  | {
      kind: "adjust";
      operation: "add" | "subtract";
      amount: AmountExpression;
      explicitTargetId?: string;
    }
  | { kind: "invalid" };

export function parseWalletCommand(input: string): WalletCommand | null {
  const text = input.trim();
  if (/\/sodu\s*$/i.test(text)) return { kind: "balance" };
  const transferMarker = text.match(/\/chuyen\b/i);
  if (transferMarker?.index !== undefined) {
    const rest = text
      .slice(transferMarker.index + transferMarker[0].length)
      .trim();
    const parsed = amountExpressionAtEnd(rest);
    if (!parsed) return { kind: "invalid" };
    const beforeAmount = rest.slice(0, parsed.start).trim();
    const explicitTargetId = /^\d+$/.test(beforeAmount)
      ? beforeAmount
      : undefined;
    return {
      kind: "transfer",
      amount: parsed.amount,
      ...(explicitTargetId ? { explicitTargetId } : {}),
    };
  }
  const marker = text.match(/\/(nap|tru)\b/i);
  if (!marker || marker.index === undefined) return null;
  const operation = marker[1]!.toLowerCase() === "nap" ? "add" : "subtract";
  const rest = text.slice(marker.index + marker[0].length).trim();
  const parsed = amountExpressionAtEnd(rest);
  if (!parsed) return { kind: "invalid" };
  const beforeAmount = rest.slice(0, parsed.start).trim();
  const explicitTargetId = /^\d+$/.test(beforeAmount)
    ? beforeAmount
    : undefined;
  return {
    kind: "adjust",
    operation,
    amount: parsed.amount,
    ...(explicitTargetId ? { explicitTargetId } : {}),
  };
}
