import { randomInt } from "node:crypto";
import { repository } from "../db.js";

export interface GameSettings {
  taiXiuWinRate: number;
  marketWinRate: number;
  jackpotRate: number;
  jackpotAmount: string;
}

const DEFAULT_WIN_RATE = 50;
const DEFAULT_JACKPOT_RATE = 1;
const DEFAULT_JACKPOT_AMOUNT = "1000000";

function readWinRate(key: string) {
  const value = Number(repository.setting(key));
  return Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : DEFAULT_WIN_RATE;
}

export function getGameSettings(): GameSettings {
  const jackpotAmount = repository.setting("games.jackpot_amount") ?? "";
  return {
    taiXiuWinRate: readWinRate("games.tai_xiu_win_rate"),
    marketWinRate: readWinRate("games.market_win_rate"),
    jackpotRate: readPercentage(
      "games.jackpot_rate",
      DEFAULT_JACKPOT_RATE,
    ),
    jackpotAmount: /^\d{1,200}$/.test(jackpotAmount)
      ? jackpotAmount
      : DEFAULT_JACKPOT_AMOUNT,
  };
}

export function saveGameSettings(settings: GameSettings): GameSettings {
  const normalized = {
    taiXiuWinRate: Math.max(0, Math.min(100, Math.round(settings.taiXiuWinRate))),
    marketWinRate: Math.max(0, Math.min(100, Math.round(settings.marketWinRate))),
    jackpotRate: Math.max(0, Math.min(100, Math.round(settings.jackpotRate))),
    jackpotAmount: /^\d{1,200}$/.test(settings.jackpotAmount)
      ? BigInt(settings.jackpotAmount).toString()
      : DEFAULT_JACKPOT_AMOUNT,
  };
  repository.setSettings({
    "games.tai_xiu_win_rate": String(normalized.taiXiuWinRate),
    "games.market_win_rate": String(normalized.marketWinRate),
    "games.jackpot_rate": String(normalized.jackpotRate),
    "games.jackpot_amount": normalized.jackpotAmount,
  });
  return normalized;
}

function readPercentage(key: string, fallback: number) {
  const value = Number(repository.setting(key));
  return Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : fallback;
}

export function configuredWin(winRate: number) {
  if (winRate <= 0) return false;
  if (winRate >= 100) return true;
  return randomInt(0, 100) < winRate;
}
