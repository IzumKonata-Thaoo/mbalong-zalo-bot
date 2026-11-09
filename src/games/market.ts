import { randomInt, randomUUID } from "node:crypto";
import { repository } from "../db.js";
import { formatBetAmount } from "./tai-xiu-rules.js";
import { configuredWin, getGameSettings } from "./game-settings.js";
import { resolveJackpot } from "./jackpot.js";
import {
  MARKET_LEVERAGES,
  MARKET_SESSION_MS,
  calculateLeveragedPnl,
  createVirtualMarket,
  formatMarketPrice,
  marketPriceAt,
  type MarketSide,
  type VirtualMarket,
} from "./market-rules.js";

export interface OpenMarketPosition {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  side: MarketSide;
  stake: bigint;
  leverage: number;
  entryPrice: number;
  openedAt: number;
  settleAt: number;
  market: VirtualMarket;
}

export interface SettledMarketPosition extends OpenMarketPosition {
  exitPrice: number;
  pnl: bigint;
  balance: bigint;
  jackpot?: boolean;
  normalPnl?: bigint;
}

const marketCache = new Map<string, VirtualMarket>();
const activePositions = new Map<string, OpenMarketPosition>();

export const marketGuide = [
  "📈 LONG/SHORT · THỊ TRƯỜNG ẢO",
  "",
  "• @MbaLong /market — xem biểu đồ hiện tại",
  "• @MbaLong /long 10000 10x",
  "• @MbaLong /short 10000 20x",
  "• @MbaLong /sodu — xem số dư dùng chung với tài xỉu",
  "• @MbaLong /bxh — xem bảng xếp hạng hai trò",
  "",
  `Đòn bẩy: ${MARKET_LEVERAGES.map((value) => `${value}x`).join(", ")}`,
  "Lệnh chốt sau 5–7 giây. Đây là trò chơi mô phỏng, không phải giá hoặc giao dịch thật.",
].join("\n");

export function currentVirtualMarket(groupId: string, now = Date.now()) {
  const sessionStart = Math.floor(now / MARKET_SESSION_MS) * MARKET_SESSION_MS;
  const key = `${groupId}:${sessionStart}`;
  let market = marketCache.get(key);
  if (!market) {
    market = createVirtualMarket(groupId, now);
    marketCache.clear();
    marketCache.set(key, market);
  }
  return market;
}

export function openMarketPosition(input: {
  groupId: string;
  senderId: string;
  senderName: string;
  side: MarketSide;
  stake: bigint;
  leverage: number;
  now?: number;
}): { ok: true; position: OpenMarketPosition } | { ok: false; message: string } {
  const now = input.now ?? Date.now();
  const key = positionKey(input.groupId, input.senderId);
  if (activePositions.has(key))
    return { ok: false, message: "Bạn đang có một vị thế chờ chốt. Hãy đợi kết quả trước khi mở lệnh mới." };
  if (input.stake <= 0n)
    return { ok: false, message: "Số tiền vào lệnh phải là số nguyên dương." };
  if (!(MARKET_LEVERAGES as readonly number[]).includes(input.leverage))
    return { ok: false, message: `Đòn bẩy không hợp lệ. Chọn: ${MARKET_LEVERAGES.map((value) => `${value}x`).join(", ")}.` };
  const balance = repository.walletBalance(input.senderId);
  if (balance < input.stake)
    return {
      ok: false,
      message: `Số dư không đủ.\n\nSố dư: ${formatBetAmount(balance)}\nTiền vào lệnh: ${formatBetAmount(input.stake)}`,
    };
  const market = currentVirtualMarket(input.groupId, now);
  const position: OpenMarketPosition = {
    id: randomUUID(),
    groupId: input.groupId,
    senderId: input.senderId,
    senderName: input.senderName,
    side: input.side,
    stake: input.stake,
    leverage: input.leverage,
    entryPrice: marketPriceAt(market, now),
    openedAt: now,
    settleAt: now + randomInt(5_000, 7_001),
    market,
  } as OpenMarketPosition;
  activePositions.set(key, position);
  return { ok: true, position };
}

export async function settleMarketPosition(
  position: OpenMarketPosition,
): Promise<SettledMarketPosition> {
  const key = positionKey(position.groupId, position.senderId);
  try {
    const wait = Math.max(0, position.settleAt - Date.now());
    if (wait) await delay(wait);
    const naturalExitPrice = marketPriceAt(position.market, position.settleAt);
    const settings = getGameSettings();
    const shouldWin = configuredWin(settings.marketWinRate);
    const movement = Math.max(1, Math.abs(naturalExitPrice - position.entryPrice));
    const winningDirection = position.side === "long" ? 1 : -1;
    const exitPrice =
      position.entryPrice + movement * winningDirection * (shouldWin ? 1 : -1);
    const calculatedPnl = calculateLeveragedPnl(
      position.stake,
      position.leverage,
      position.side,
      position.entryPrice,
      exitPrice,
    );
    const jackpot = resolveJackpot(calculatedPnl, settings);
    const settlement = repository.settleMarketGame(
      position.senderId,
      jackpot.profit,
      position.senderName,
    );
    const pnl = settlement.pnl;
    repository.audit(position.senderId, "market.settle", position.id, {
      groupId: position.groupId,
      side: position.side,
      stake: position.stake.toString(),
      leverage: position.leverage,
      entryPrice: position.entryPrice,
      exitPrice,
      pnl: pnl.toString(),
      normalPnl: calculatedPnl.toString(),
      jackpot: jackpot.hit,
      balanceAfter: settlement.balance.toString(),
    });
    return {
      ...position,
      exitPrice,
      pnl,
      balance: settlement.balance,
      jackpot: jackpot.hit,
      normalPnl: calculatedPnl,
    };
  } finally {
    if (activePositions.get(key)?.id === position.id) activePositions.delete(key);
  }
}

export function cancelMarketPosition(position: OpenMarketPosition) {
  const key = positionKey(position.groupId, position.senderId);
  if (activePositions.get(key)?.id === position.id) activePositions.delete(key);
}

export function marketOpenMessage(position: OpenMarketPosition) {
  const seconds = ((position.settleAt - position.openedAt) / 1_000).toFixed(1);
  return [
    `${position.side === "long" ? "🟢" : "🔴"} ĐÃ MỞ ${position.side.toUpperCase()} ${position.leverage}x`,
    "",
    `Giá vào: ${formatMarketPrice(position.entryPrice)}`,
    `Tiền vào lệnh: ${formatBetAmount(position.stake)}`,
    `Ký quỹ: Isolated · Chốt sau ${seconds}s`,
  ].join("\n");
}

export function marketResultMessage(position: SettledMarketPosition) {
  const outcome = position.pnl > 0n ? "✅ THẮNG" : position.pnl < 0n ? "❌ THUA" : "➖ HÒA";
  const sign = position.pnl > 0n ? "+" : position.pnl < 0n ? "−" : "";
  const absolutePnl = position.pnl < 0n ? -position.pnl : position.pnl;
  const priceDirection = position.exitPrice >= position.entryPrice ? "↗" : "↘";
  return [
    `📊 KẾT QUẢ ${position.side.toUpperCase()} · ${outcome}`,
    "",
    `Giá vào: ${formatMarketPrice(position.entryPrice)}`,
    `Giá chốt: ${formatMarketPrice(position.exitPrice)} ${priceDirection}`,
    `Đòn bẩy: ${position.leverage}x`,
    ...(position.jackpot
      ? [`💥 NỔ HŨ · Thưởng ${formatBetAmount(position.pnl)}`]
      : []),
    `PnL: ${sign}${formatBetAmount(absolutePnl)}`,
    `Số dư mới: ${formatBetAmount(position.balance)}`,
  ].join("\n");
}

function positionKey(groupId: string, senderId: string) {
  return `${groupId}:${senderId}`;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
