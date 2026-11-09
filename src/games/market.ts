import { randomInt, randomUUID } from "node:crypto";
import { repository } from "../db.js";
import { formatBetAmount } from "./tai-xiu-rules.js";
import { configuredWin, getGameSettings } from "./game-settings.js";
import { resolveJackpot } from "./jackpot.js";
import {
  MARKET_MAX_SETTLE_MS,
  MARKET_MIN_SETTLE_MS,
  MARKET_SESSION_MS,
  calculateLeveragedPnl,
  createVirtualMarket,
  formatMarketPrice,
  formatSettleDuration,
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
  leverage: bigint;
  entryPrice: number;
  openedAt: number;
  /** Real wall-clock time when the bot returns the result (always 5–7 seconds). */
  settleAt: number;
  /** Simulated market timestamp selected by the player for price/PnL. */
  marketCloseAt: number;
  market: VirtualMarket;
}

export interface SettledMarketPosition extends OpenMarketPosition {
  exitPrice: number;
  pnl: bigint;
  balance: bigint;
  jackpot?: boolean;
  normalPnl?: bigint;
  liquidated?: boolean;
}

const marketCache = new Map<string, VirtualMarket>();
const activePositions = new Map<string, OpenMarketPosition>();

export const marketGuide = [
  "📈 LONG/SHORT · THỊ TRƯỜNG ẢO",
  "",
  "• @MbaLong /market — xem biểu đồ hiện tại",
  "• @MbaLong /long 10000 10x 30s",
  "• @MbaLong /short 10000 20x 2m",
  "• @MbaLong /sodu — xem số dư dùng chung với tài xỉu",
  "• @MbaLong /bxh — xem bảng xếp hạng hai trò",
  "",
  "Đòn bẩy: nhập số nguyên dương bất kỳ, không giới hạn mức tối đa.",
  "Khung chốt mô phỏng: 5s–5m (ví dụ 30s, 2m). Khung dài có thể tạo biên độ lớn hơn.",
  "Bot luôn trả kết quả sau khoảng 5–7 giây. Nếu số dư về 0 lúc đang xử lý, bot tự đóng lệnh.",
  "Đây là trò chơi mô phỏng, không phải giá hoặc giao dịch thật.",
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
  leverage: bigint;
  settleAfterMs?: number;
  now?: number;
}): { ok: true; position: OpenMarketPosition } | { ok: false; message: string } {
  const now = input.now ?? Date.now();
  const key = positionKey(input.groupId, input.senderId);
  if (activePositions.has(key))
    return { ok: false, message: "Bạn đang có một vị thế chờ chốt. Hãy đợi kết quả trước khi mở lệnh mới." };
  if (input.stake <= 0n)
    return { ok: false, message: "Số tiền vào lệnh phải là số nguyên dương." };
  if (input.leverage <= 0n)
    return { ok: false, message: "Đòn bẩy phải là số nguyên dương." };
  if (
    input.settleAfterMs !== undefined &&
    (!Number.isSafeInteger(input.settleAfterMs) ||
      input.settleAfterMs < MARKET_MIN_SETTLE_MS ||
      input.settleAfterMs > MARKET_MAX_SETTLE_MS)
  )
    return {
      ok: false,
      message: "Thời gian chốt phải từ 5 giây đến 5 phút.",
    };
  const balance = repository.walletBalance(input.senderId);
  if (balance < input.stake)
    return {
      ok: false,
      message: `Số dư không đủ.\n\nSố dư: ${formatBetAmount(balance)}\nTiền vào lệnh: ${formatBetAmount(input.stake)}`,
    };
  const market = currentVirtualMarket(input.groupId, now);
  const processingDelay = randomInt(5_000, 7_001);
  const marketDuration = input.settleAfterMs ?? processingDelay;
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
    settleAt: now + processingDelay,
    marketCloseAt: now + marketDuration,
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
    const liquidated = await waitForSettleOrEmptyWallet(position);
    if (liquidated) {
      const closedAt = Date.now();
      const exitPrice = marketPriceAt(position.market, closedAt);
      repository.audit(position.senderId, "market.liquidated", position.id, {
        groupId: position.groupId,
        side: position.side,
        stake: position.stake.toString(),
        leverage: position.leverage.toString(),
        openedAt: position.openedAt,
        closedAt,
        reason: "wallet_empty",
      });
      return {
        ...position,
        exitPrice,
        pnl: 0n,
        balance: 0n,
        liquidated: true,
      };
    }
    const naturalExitPrice = marketPriceAt(
      position.market,
      position.marketCloseAt,
    );
    const settings = getGameSettings();
    const shouldWin = configuredWin(settings.marketWinRate);
    const rawMovement = Math.max(
      1,
      Math.abs(naturalExitPrice - position.entryPrice),
    );
    const marketDuration = position.marketCloseAt - position.openedAt;
    // Losing positions get a more visible adverse move. Longer simulated
    // windows amplify it further, while calculateLeveragedPnl still caps loss
    // at the user's stake.
    const lossMultiplier = shouldWin
      ? 1
      : 2 + Math.min(5, marketDuration / 60_000);
    const movement = Math.max(1, Math.round(rawMovement * lossMultiplier));
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
      leverage: position.leverage.toString(),
      marketDurationMs: position.marketCloseAt - position.openedAt,
      lossMultiplier,
      processingDelayMs: position.settleAt - position.openedAt,
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
  const duration = formatSettleDuration(
    position.marketCloseAt - position.openedAt,
  );
  return [
    `${position.side === "long" ? "🟢" : "🔴"} ĐÃ MỞ ${position.side.toUpperCase()} ${position.leverage}x`,
    "",
    `Giá vào: ${formatMarketPrice(position.entryPrice)}`,
    `Tiền vào lệnh: ${formatBetAmount(position.stake)}`,
    `Khung chốt mô phỏng: ${duration}`,
    "Kết quả trả sau khoảng 5–7 giây",
  ].join("\n");
}

export function marketResultMessage(position: SettledMarketPosition) {
  if (position.liquidated)
    return [
      `⚠️ ĐÃ ĐÓNG SỚM ${position.side.toUpperCase()} ${position.leverage}x`,
      "",
      "Số dư đã về 0 khi lệnh còn mở.",
      "Vị thế được đóng ngay và không tính kết quả thắng/thua.",
      `Số dư hiện tại: ${formatBetAmount(position.balance)}`,
    ].join("\n");
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

async function waitForSettleOrEmptyWallet(position: OpenMarketPosition) {
  for (;;) {
    if (repository.walletBalance(position.senderId) <= 0n) return true;
    const remaining = position.settleAt - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(500, remaining));
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
