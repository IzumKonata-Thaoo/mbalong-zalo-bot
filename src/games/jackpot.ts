import { configuredWin, type GameSettings } from "./game-settings.js";

export interface JackpotResult {
  hit: boolean;
  normalProfit: bigint;
  profit: bigint;
}

/** Jackpot is rolled only for a winning result. */
export function resolveJackpot(
  normalProfit: bigint,
  settings: Pick<GameSettings, "jackpotRate" | "jackpotAmount">,
): JackpotResult {
  if (normalProfit <= 0n || !configuredWin(settings.jackpotRate))
    return { hit: false, normalProfit, profit: normalProfit };
  const configuredAmount = BigInt(settings.jackpotAmount);
  return {
    hit: true,
    normalProfit,
    profit:
      configuredAmount < normalProfit
        ? normalProfit * 2n
        : configuredAmount,
  };
}
