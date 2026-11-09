import { randomInt } from "node:crypto";
import { repository } from "../db.js";

export interface GameSettings {
  taiXiuWinRate: number;
  marketWinRate: number;
}

const DEFAULT_WIN_RATE = 50;

function readWinRate(key: string) {
  const value = Number(repository.setting(key));
  return Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : DEFAULT_WIN_RATE;
}

export function getGameSettings(): GameSettings {
  return {
    taiXiuWinRate: readWinRate("games.tai_xiu_win_rate"),
    marketWinRate: readWinRate("games.market_win_rate"),
  };
}

export function saveGameSettings(settings: GameSettings): GameSettings {
  const normalized = {
    taiXiuWinRate: Math.max(0, Math.min(100, Math.round(settings.taiXiuWinRate))),
    marketWinRate: Math.max(0, Math.min(100, Math.round(settings.marketWinRate))),
  };
  repository.setSettings({
    "games.tai_xiu_win_rate": String(normalized.taiXiuWinRate),
    "games.market_win_rate": String(normalized.marketWinRate),
  });
  return normalized;
}

export function configuredWin(winRate: number) {
  if (winRate <= 0) return false;
  if (winRate >= 100) return true;
  return randomInt(0, 100) < winRate;
}
