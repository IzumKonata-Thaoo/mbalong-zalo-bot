export type WalletCommand =
  | { kind: "balance" }
  | {
      kind: "adjust";
      operation: "add" | "subtract";
      amount: bigint;
      explicitTargetId?: string;
    }
  | { kind: "invalid" };

export function parseWalletCommand(input: string): WalletCommand | null {
  const text = input.trim();
  if (/\/sodu\s*$/i.test(text)) return { kind: "balance" };
  const marker = text.match(/\/(nap|tru)\b/i);
  if (!marker || marker.index === undefined) return null;
  const operation = marker[1]!.toLowerCase() === "nap" ? "add" : "subtract";
  const rest = text.slice(marker.index + marker[0].length).trim();
  const direct = rest.match(/^(\d+)\s+([1-9]\d*)$/);
  if (direct)
    return {
      kind: "adjust",
      operation,
      explicitTargetId: direct[1],
      amount: BigInt(direct[2]!),
    };
  const amount = rest.match(/([1-9]\d*)\s*$/);
  if (!amount) return { kind: "invalid" };
  return { kind: "adjust", operation, amount: BigInt(amount[1]!) };
}
