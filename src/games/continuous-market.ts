import { randomUUID } from "node:crypto";
import { repository } from "../db.js";
import { formatBetAmount } from "./tai-xiu-rules.js";
import { currentVirtualMarket } from "./market.js";
import { getGameSettings } from "./game-settings.js";
import { resolveWipeout } from "./jackpot.js";
import {
  calculateLeveragedPnl,
  formatMarketPrice,
  marketPriceAt,
  marketSymbolLabel,
  type MarketSide,
  type MarketSymbol,
} from "./market-rules.js";

interface BalanceRatio {
  numerator: bigint;
  denominator: bigint;
  label: string;
}

export type ContinuousMarketCommand =
  | { kind: "help" }
  | { kind: "close" }
  | { kind: "status" }
  | {
      kind: "open";
      symbol: MarketSymbol;
      side: MarketSide;
      leverage: bigint;
      stopLoss?: BalanceRatio;
      takeProfit?: BalanceRatio;
    }
  | { kind: "invalid" };

interface ContinuousPosition {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  symbol: MarketSymbol;
  side: MarketSide;
  leverage: bigint;
  initialBalance: bigint;
  balance: bigint;
  cumulativePnl: bigint;
  entryPrice: number;
  lastPrice: number;
  openedAt: number;
  stopLoss?: BalanceRatio;
  takeProfit?: BalanceRatio;
  timer?: NodeJS.Timeout;
  alertedMilestones: Set<string>;
  notify: (message: string) => Promise<void>;
}

type CloseReason = "manual" | "stop_loss" | "take_profit" | "liquidated";

const positions = new Map<string, ContinuousPosition>();
const TICK_MS = 1_000;
export const CONTINUOUS_MAX_LEVERAGE = 1_000n;

export const continuousMarketGuide = [
  "♾️ CHƠI LONG/SHORT LIÊN TỤC",
  "",
  "• @MbaLong /choicho btc long 10x sl 0.5x tp 2x",
  "• @MbaLong /choicho eth short 20x sl 0.7x tp 1.5x",
  "• @MbaLong /lenh — xem vị thế và PnL hiện tại",
  "• @MbaLong /chot — đóng vị thế thủ công",
  "",
  "Đòn bẩy /choicho: từ 1x đến tối đa 1000x.",
  "/choicho mặc định dùng toàn bộ số dư, tương đương allin.",
  "SL/TP tính theo số dư lúc mở. Ví dụ SL 0.5x đóng khi còn 50%, TP 2x đóng khi số dư gấp đôi.",
  "PnL được cộng hoặc trừ trực tiếp vào số dư mỗi giây. Số dư về 0 thì cháy ví và tự đóng.",
].join("\n");

export function parseContinuousMarketCommand(
  input: string,
): ContinuousMarketCommand | null {
  const text = input.trim().toLowerCase();
  if (/^\/chot\s*$/.test(text)) return { kind: "close" };
  if (/^\/lenh\s*$/.test(text)) return { kind: "status" };
  if (!text.startsWith("/choicho")) return null;
  const tokens = text.slice("/choicho".length).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { kind: "help" };

  let symbol: MarketSymbol = "xau";
  if (/^(?:xau|btc|eth)$/.test(tokens[0]!))
    symbol = tokens.shift() as MarketSymbol;
  const side = tokens.shift();
  const leverageToken = tokens.shift();
  if (!/^(?:long|short)$/.test(side ?? "") || !leverageToken)
    return { kind: "invalid" };
  const leverageMatch = leverageToken.match(/^(?:x(\d+)|(\d+)x)$/);
  if (!leverageMatch) return { kind: "invalid" };
  const leverage = BigInt(leverageMatch[1] ?? leverageMatch[2]!);
  if (leverage <= 0n || leverage > CONTINUOUS_MAX_LEVERAGE)
    return { kind: "invalid" };

  let stopLoss: BalanceRatio | undefined;
  let takeProfit: BalanceRatio | undefined;
  while (tokens.length) {
    const option = tokens.shift();
    const value = tokens.shift();
    if (!value || (option !== "sl" && option !== "tp"))
      return { kind: "invalid" };
    const ratio = parseRatio(value);
    if (!ratio) return { kind: "invalid" };
    if (option === "sl") {
      if (stopLoss || ratio.numerator >= ratio.denominator)
        return { kind: "invalid" };
      stopLoss = ratio;
    } else {
      if (takeProfit || ratio.numerator <= ratio.denominator)
        return { kind: "invalid" };
      takeProfit = ratio;
    }
  }

  return {
    kind: "open",
    symbol,
    side: side as MarketSide,
    leverage,
    ...(stopLoss ? { stopLoss } : {}),
    ...(takeProfit ? { takeProfit } : {}),
  };
}

export function openContinuousPosition(input: {
  groupId: string;
  senderId: string;
  senderName: string;
  symbol: MarketSymbol;
  side: MarketSide;
  leverage: bigint;
  stopLoss?: BalanceRatio;
  takeProfit?: BalanceRatio;
  notify: (message: string) => Promise<void>;
}) {
  if (input.leverage <= 0n || input.leverage > CONTINUOUS_MAX_LEVERAGE)
    return {
      ok: false as const,
      message: "Đòn bẩy /choicho phải từ 1x đến tối đa 1000x.",
    };
  if (positions.has(input.senderId))
    return { ok: false as const, message: "Bạn đang có một vị thế /choicho. Dùng /lenh để xem hoặc /chot để đóng." };
  const initialBalance = repository.walletBalance(input.senderId);
  if (initialBalance <= 0n)
    return { ok: false as const, message: "Số dư phải lớn hơn 0 để mở /choicho." };
  const now = Date.now();
  const market = currentVirtualMarket(input.groupId, now, input.symbol);
  const entryPrice = marketPriceAt(market, now);
  const position: ContinuousPosition = {
    id: randomUUID(),
    ...input,
    initialBalance,
    balance: initialBalance,
    cumulativePnl: 0n,
    entryPrice,
    lastPrice: entryPrice,
    openedAt: now,
    alertedMilestones: new Set(),
  };
  positions.set(input.senderId, position);
  scheduleTick(position);
  repository.audit(input.senderId, "market.continuous.open", position.id, {
    groupId: input.groupId,
    symbol: input.symbol,
    side: input.side,
    leverage: input.leverage.toString(),
    initialBalance: initialBalance.toString(),
    stopLoss: input.stopLoss?.label,
    takeProfit: input.takeProfit?.label,
  });
  return { ok: true as const, message: openMessage(position) };
}

export function closeContinuousPosition(senderId: string) {
  const position = positions.get(senderId);
  if (!position)
    return "Bạn chưa có vị thế /choicho đang chạy.";
  return finishPosition(position, "manual", false);
}

export function continuousPositionStatus(senderId: string) {
  const position = positions.get(senderId);
  if (!position) return "Bạn chưa có vị thế /choicho đang chạy.";
  return statusMessage(position);
}

function scheduleTick(position: ContinuousPosition) {
  position.timer = setTimeout(() => void tickPosition(position), TICK_MS);
  position.timer.unref();
}

async function tickPosition(position: ContinuousPosition) {
  if (positions.get(position.senderId)?.id !== position.id) return;
  try {
    const currentBalance = repository.walletBalance(position.senderId);
    if (currentBalance <= 0n) {
      await finishPosition(position, "liquidated", true);
      return;
    }
    const now = Date.now();
    const market = currentVirtualMarket(position.groupId, now, position.symbol);
    const currentPrice = marketPriceAt(market, now);
    const requestedPnl = calculateLeveragedPnl(
      currentBalance,
      position.leverage,
      position.side,
      position.lastPrice,
      currentPrice,
    );
    const changed = applyContinuousWalletPnl(
      position.senderId,
      requestedPnl,
    );
    position.balance = changed.balance;
    position.cumulativePnl += changed.pnl;
    position.lastPrice = currentPrice;

    if (position.balance <= 0n) {
      await finishPosition(position, "liquidated", true);
      return;
    }
    if (
      position.stopLoss &&
      position.balance * position.stopLoss.denominator <=
        position.initialBalance * position.stopLoss.numerator
    ) {
      await finishPosition(position, "stop_loss", true);
      return;
    }
    if (
      position.takeProfit &&
      position.balance * position.takeProfit.denominator >=
        position.initialBalance * position.takeProfit.numerator
    ) {
      await finishPosition(position, "take_profit", true);
      return;
    }
    const alert = nextBalanceAlert(position);
    if (alert) {
      await position.notify(alert);
      if (positions.get(position.senderId)?.id !== position.id) return;
    }
    scheduleTick(position);
  } catch (error) {
    console.error("Continuous market tick error", error);
    if (positions.get(position.senderId)?.id === position.id)
      scheduleTick(position);
  }
}

/** Applies one continuous PnL tick to the real wallet and caps a loss at zero. */
export function applyContinuousWalletPnl(
  senderId: string,
  requestedPnl: bigint,
) {
  const currentBalance = repository.walletBalance(senderId);
  const pnl = requestedPnl < -currentBalance ? -currentBalance : requestedPnl;
  const changed = repository.adjustWalletBalance(senderId, pnl);
  if (!changed.ok)
    throw new Error("Không thể cập nhật số dư /choicho");
  return { pnl, previous: changed.previous, balance: changed.balance };
}

function finishPosition(
  position: ContinuousPosition,
  reason: CloseReason,
  notify: boolean,
) {
  if (positions.get(position.senderId)?.id !== position.id)
    return "Vị thế đã được đóng.";
  if (position.timer) clearTimeout(position.timer);
  positions.delete(position.senderId);
  const wipeout =
    repository.walletBalance(position.senderId) > 0n &&
    resolveWipeout(getGameSettings());
  if (wipeout) {
    const wiped = repository.wipeWalletBalance(position.senderId);
    position.cumulativePnl -= wiped.previous;
  }
  const balance = repository.walletBalance(position.senderId);
  position.balance = balance;
  repository.recordGameResult(
    position.senderId,
    position.senderName,
    position.cumulativePnl,
  );
  repository.audit(position.senderId, "market.continuous.close", position.id, {
    groupId: position.groupId,
    symbol: position.symbol,
    side: position.side,
    leverage: position.leverage.toString(),
    reason,
    initialBalance: position.initialBalance.toString(),
    finalBalance: balance.toString(),
    pnl: position.cumulativePnl.toString(),
    wipeout,
  });
  const message = wipeout
    ? [
        `💣 HŨ CHÁY VÍ · ${marketSymbolLabel(position.symbol)}`,
        "",
        "Toàn bộ số dư đã bị trừ khi đóng lệnh.",
        `PnL chung cuộc: −${formatBetAmount(-position.cumulativePnl)}`,
        "Số dư mới: 0",
      ].join("\n")
    : closeMessage(position, reason);
  if (notify)
    void position.notify(message).catch((error) =>
      console.error("Continuous market close notification error", error),
    );
  return message;
}

function openMessage(position: ContinuousPosition) {
  return [
    `♾️ ĐÃ MỞ ${position.side.toUpperCase()} ${marketSymbolLabel(position.symbol)} ${position.leverage}x`,
    "",
    `Giá vào: ${formatMarketPrice(position.entryPrice)}`,
    `Số dư mốc: ${formatBetAmount(position.initialBalance)}`,
    `Stop loss: ${position.stopLoss?.label ?? "không đặt"}`,
    `Take profit: ${position.takeProfit?.label ?? "không đặt"}`,
    "PnL được cập nhật thẳng vào số dư mỗi giây.",
  ].join("\n");
}

function statusMessage(position: ContinuousPosition) {
  const sign = position.cumulativePnl > 0n ? "+" : position.cumulativePnl < 0n ? "−" : "";
  const pnl = position.cumulativePnl < 0n ? -position.cumulativePnl : position.cumulativePnl;
  return [
    `📍 ${position.side.toUpperCase()} ${marketSymbolLabel(position.symbol)} ${position.leverage}x`,
    "",
    `Giá vào: ${formatMarketPrice(position.entryPrice)}`,
    `Giá hiện tại: ${formatMarketPrice(position.lastPrice)}`,
    `PnL vị thế: ${sign}${formatBetAmount(pnl)}`,
    `Số dư hiện tại: ${formatBetAmount(repository.walletBalance(position.senderId))}`,
    `SL: ${position.stopLoss?.label ?? "—"} · TP: ${position.takeProfit?.label ?? "—"}`,
  ].join("\n");
}

function closeMessage(position: ContinuousPosition, reason: CloseReason) {
  const heading = {
    manual: "✅ ĐÃ CHỐT LỆNH",
    stop_loss: "🛑 ĐÃ CHẠM STOP LOSS",
    take_profit: "🎯 ĐÃ CHẠM TAKE PROFIT",
    liquidated: "🔥 CHÁY VÍ · TỰ ĐÓNG LỆNH",
  }[reason];
  const sign = position.cumulativePnl > 0n ? "+" : position.cumulativePnl < 0n ? "−" : "";
  const pnl = position.cumulativePnl < 0n ? -position.cumulativePnl : position.cumulativePnl;
  return [
    `${heading} · ${marketSymbolLabel(position.symbol)}`,
    "",
    `Vị thế: ${position.side.toUpperCase()} ${position.leverage}x`,
    `PnL: ${sign}${formatBetAmount(pnl)}`,
    `Số dư mới: ${formatBetAmount(position.balance)}`,
  ].join("\n");
}

function nextBalanceAlert(position: ContinuousPosition) {
  const milestone = detectBalanceMilestone(
    position.initialBalance,
    position.balance,
    position.alertedMilestones,
  );
  return milestone
    ? balanceAlertMessage(position, milestone.direction, milestone.level)
    : null;
}

export function detectBalanceMilestone(
  initialBalance: bigint,
  balance: bigint,
  alertedMilestones: Set<string>,
) {
  const lossLevels = [75n, 50n, 25n];
  const profitLevels = [125n, 150n, 200n, 300n, 500n, 1_000n, 2_000n, 5_000n, 10_000n];
  const crossedLosses = lossLevels.filter(
    (level) =>
      balance * 100n <= initialBalance * level &&
      !alertedMilestones.has(`loss:${level}`),
  );
  if (crossedLosses.length) {
    for (const level of crossedLosses)
      alertedMilestones.add(`loss:${level}`);
    const level = crossedLosses.at(-1)!;
    return { direction: "loss" as const, level };
  }
  const crossedProfits = profitLevels.filter(
    (level) =>
      balance * 100n >= initialBalance * level &&
      !alertedMilestones.has(`profit:${level}`),
  );
  if (crossedProfits.length) {
    for (const level of crossedProfits)
      alertedMilestones.add(`profit:${level}`);
    const level = crossedProfits.at(-1)!;
    return { direction: "profit" as const, level };
  }
  return null;
}

function balanceAlertMessage(
  position: ContinuousPosition,
  direction: "loss" | "profit",
  level: bigint,
) {
  const sign = position.cumulativePnl >= 0n ? "+" : "−";
  const pnl = position.cumulativePnl < 0n ? -position.cumulativePnl : position.cumulativePnl;
  const levelText =
    level < 100n
      ? `còn ${level}% số dư lúc mở`
      : `đạt ${formatRatioPercent(level)} số dư lúc mở`;
  return [
    `${direction === "loss" ? "⚠️ CẢNH BÁO GIẢM MẠNH" : "🚀 CẢNH BÁO TĂNG MẠNH"} · ${marketSymbolLabel(position.symbol)}`,
    "",
    `Số dư đã ${levelText}.`,
    `PnL vị thế: ${sign}${formatBetAmount(pnl)}`,
    `Số dư hiện tại: ${formatBetAmount(position.balance)}`,
    "Dùng @MbaLong /chot để chốt hoặc /lenh để xem chi tiết.",
  ].join("\n");
}

function formatRatioPercent(percent: bigint) {
  const whole = percent / 100n;
  const remainder = percent % 100n;
  return remainder ? `${whole},${remainder.toString().padStart(2, "0").replace(/0+$/, "")}x` : `${whole}x`;
}

function parseRatio(value: string): BalanceRatio | null {
  const match = value.replace(",", ".").match(/^(\d+)(?:\.(\d+))?x$/);
  if (!match) return null;
  const decimals = match[2] ?? "";
  const denominator = 10n ** BigInt(decimals.length);
  const numerator = BigInt(`${match[1]}${decimals}`);
  if (numerator <= 0n) return null;
  return { numerator, denominator, label: `${match[1]}${decimals ? `.${decimals}` : ""}x` };
}
