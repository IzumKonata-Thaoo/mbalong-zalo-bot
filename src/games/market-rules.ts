export const MARKET_SESSION_MS = 5 * 60 * 60 * 1_000;
export const MARKET_HISTORY_SECONDS = 60 * 60;
export const MARKET_MIN_SETTLE_MS = 5_000;
export const MARKET_MAX_SETTLE_MS = 5 * 60 * 1_000;
export const MARKET_SYMBOLS = ["xau", "btc", "eth"] as const;

export type MarketSide = "long" | "short";
export type MarketSymbol = (typeof MARKET_SYMBOLS)[number];
export type MarketCommand =
  | { kind: "market"; symbol?: MarketSymbol }
  | { kind: "help" }
  | {
      kind: "position";
      side: MarketSide;
      stake: bigint;
      leverage: bigint;
      settleAfterMs?: number;
      symbol?: MarketSymbol;
    }
  | { kind: "invalid" };

export interface VirtualMarket {
  groupId: string;
  symbol: MarketSymbol;
  sessionStart: number;
  sessionEnd: number;
  /** Prices are stored in cents and include one hour of pre-session history. */
  prices: number[];
}

export interface MarketCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function parseMarketCommand(input: string): MarketCommand | null {
  const text = input.trim();
  const marketMatch = text.match(
    /^(?:\/market|\/thitruong|xem\s+thị\s+trường|xem\s+thi\s+truong)(?:\s+(xau|btc|eth))?$/i,
  );
  if (marketMatch)
    return {
      kind: "market",
      ...(marketMatch[1]
        ? { symbol: marketMatch[1].toLowerCase() as MarketSymbol }
        : {}),
    };
  if (/^\/(?:trade|giaodich)\s*$/i.test(text)) return { kind: "help" };
  const marker = text.match(/^\/(long|short)\b/i);
  if (!marker) return null;
  let rest = text.slice(marker[0].length).trim();
  let symbol: MarketSymbol | undefined;
  const symbolMatch = rest.match(/^(xau|btc|eth)\s+/i);
  if (symbolMatch) {
    symbol = symbolMatch[1]!.toLowerCase() as MarketSymbol;
    rest = rest.slice(symbolMatch[0].length);
  }
  const match = rest.match(
    /^([1-9]\d*)\s+(?:x(\d+)|(\d+)x)(?:\s+([1-9]\d*)\s*(s|m|giây|giay|phút|phut)?)?$/i,
  );
  if (!match) return { kind: "invalid" };
  const leverage = BigInt(match[2] ?? match[3]!);
  if (leverage <= 0n) return { kind: "invalid" };
  let settleAfterMs: number | undefined;
  if (match[4]) {
    const value = Number(match[4]);
    const unit = (match[5] ?? "s").toLowerCase();
    const seconds = /^(?:m|phút|phut)$/.test(unit) ? value * 60 : value;
    settleAfterMs = seconds * 1_000;
    if (
      !Number.isSafeInteger(settleAfterMs) ||
      settleAfterMs < MARKET_MIN_SETTLE_MS ||
      settleAfterMs > MARKET_MAX_SETTLE_MS
    )
      return { kind: "invalid" };
  }
  return {
    kind: "position",
    side: marker[1]!.toLowerCase() as MarketSide,
    stake: BigInt(match[1]!),
    leverage,
    ...(settleAfterMs ? { settleAfterMs } : {}),
    ...(symbol && symbol !== "xau" ? { symbol } : {}),
  };
}

export function marketSymbolLabel(symbol: MarketSymbol) {
  return `${symbol.toUpperCase()}USDT`;
}

export function formatSettleDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} phút`;
  return `${seconds} giây`;
}

export function createVirtualMarket(
  groupId: string,
  now = Date.now(),
  symbol: MarketSymbol = "xau",
): VirtualMarket {
  const sessionStart = Math.floor(now / MARKET_SESSION_MS) * MARKET_SESSION_MS;
  const sessionEnd = sessionStart + MARKET_SESSION_MS;
  const seconds = MARKET_HISTORY_SECONDS + MARKET_SESSION_MS / 1_000 + 10;
  const random = mulberry32(hash32(`${groupId}:${symbol}:${sessionStart}`));
  const groupSeed = hash32(`${groupId}:${symbol}`);
  const profile = {
    xau: { base: 265_000, spread: 30_000, volatility: 1 },
    btc: { base: 7_000_000, spread: 900_000, volatility: 30 },
    eth: { base: 350_000, spread: 80_000, volatility: 4 },
  }[symbol];
  let price = profile.base + (groupSeed % profile.spread);
  let momentum = 0;
  const prices: number[] = [];
  for (let index = 0; index <= seconds; index++) {
    momentum = momentum * 0.82 + (random() - 0.5) * 18;
    const wave = Math.sin((index + (groupSeed % 997)) / 73) * 3.2;
    const shock = random() < 0.003 ? (random() - 0.5) * 180 : 0;
    const delta = Math.round(
      (momentum + wave + (random() - 0.5) * 24 + shock) *
        profile.volatility,
    );
    price = Math.max(50_000, price + delta);
    prices.push(price);
  }
  return { groupId, symbol, sessionStart, sessionEnd, prices };
}

export function marketPriceAt(market: VirtualMarket, at = Date.now()): number {
  const elapsed = Math.floor((at - market.sessionStart) / 1_000);
  const index = Math.max(
    0,
    Math.min(market.prices.length - 1, MARKET_HISTORY_SECONDS + elapsed),
  );
  return market.prices[index]!;
}

export function marketCandles(
  market: VirtualMarket,
  at = Date.now(),
  count = 60,
  secondsPerCandle = 60,
): MarketCandle[] {
  const currentIndex = Math.max(
    MARKET_HISTORY_SECONDS,
    Math.min(
      market.prices.length - 1,
      MARKET_HISTORY_SECONDS + Math.floor((at - market.sessionStart) / 1_000),
    ),
  );
  const candles: MarketCandle[] = [];
  for (let candle = count - 1; candle >= 0; candle--) {
    const end = currentIndex - candle * secondsPerCandle;
    const start = Math.max(0, end - secondsPerCandle + 1);
    const slice = market.prices.slice(start, end + 1);
    if (!slice.length) continue;
    const open = slice[0]!;
    const close = slice.at(-1)!;
    candles.push({
      time: at - candle * secondsPerCandle * 1_000,
      open,
      high: Math.max(...slice),
      low: Math.min(...slice),
      close,
      volume: Math.max(20, Math.round(30 + Math.abs(close - open) * 1.7)),
    });
  }
  return candles;
}

export function calculateLeveragedPnl(
  stake: bigint,
  leverage: bigint,
  side: MarketSide,
  entryPrice: number,
  exitPrice: number,
): bigint {
  if (stake <= 0n || entryPrice <= 0) return 0n;
  const direction = side === "long" ? 1 : -1;
  const numerator =
    stake * BigInt((exitPrice - entryPrice) * direction) * leverage;
  let pnl = numerator / BigInt(entryPrice);
  if (pnl === 0n && exitPrice !== entryPrice)
    pnl = (exitPrice - entryPrice) * direction > 0 ? 1n : -1n;
  return pnl < -stake ? -stake : pnl;
}

export function formatMarketPrice(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
