export const MARKET_SESSION_MS = 5 * 60 * 60 * 1_000;
export const MARKET_HISTORY_SECONDS = 60 * 60;
export const MARKET_LEVERAGES = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100] as const;

export type MarketSide = "long" | "short";
export type MarketCommand =
  | { kind: "market" }
  | { kind: "help" }
  | { kind: "position"; side: MarketSide; stake: bigint; leverage: number }
  | { kind: "invalid" };

export interface VirtualMarket {
  groupId: string;
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
  if (/^(?:\/market|\/thitruong|xem\s+thị\s+trường|xem\s+thi\s+truong)$/i.test(text))
    return { kind: "market" };
  if (/^\/(?:trade|giaodich)\s*$/i.test(text)) return { kind: "help" };
  const marker = text.match(/^\/(long|short)\b/i);
  if (!marker) return null;
  const rest = text.slice(marker[0].length).trim();
  const match = rest.match(/^([1-9]\d*)\s+(?:x(\d+)|(\d+)x)$/i);
  if (!match) return { kind: "invalid" };
  const leverage = Number(match[2] ?? match[3]);
  if (!(MARKET_LEVERAGES as readonly number[]).includes(leverage))
    return { kind: "invalid" };
  return {
    kind: "position",
    side: marker[1]!.toLowerCase() as MarketSide,
    stake: BigInt(match[1]!),
    leverage,
  };
}

export function createVirtualMarket(groupId: string, now = Date.now()): VirtualMarket {
  const sessionStart = Math.floor(now / MARKET_SESSION_MS) * MARKET_SESSION_MS;
  const sessionEnd = sessionStart + MARKET_SESSION_MS;
  const seconds = MARKET_HISTORY_SECONDS + MARKET_SESSION_MS / 1_000 + 10;
  const random = mulberry32(hash32(`${groupId}:${sessionStart}`));
  const groupSeed = hash32(groupId);
  let price = 245_000 + (groupSeed % 35_000);
  let momentum = 0;
  const prices: number[] = [];
  for (let index = 0; index <= seconds; index++) {
    momentum = momentum * 0.82 + (random() - 0.5) * 18;
    const wave = Math.sin((index + (groupSeed % 997)) / 73) * 3.2;
    const shock = random() < 0.003 ? (random() - 0.5) * 180 : 0;
    const delta = Math.round(momentum + wave + (random() - 0.5) * 24 + shock);
    price = Math.max(50_000, price + delta);
    prices.push(price);
  }
  return { groupId, sessionStart, sessionEnd, prices };
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
  leverage: number,
  side: MarketSide,
  entryPrice: number,
  exitPrice: number,
): bigint {
  if (stake <= 0n || entryPrice <= 0) return 0n;
  const direction = side === "long" ? 1 : -1;
  const numerator = stake * BigInt((exitPrice - entryPrice) * direction * leverage);
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
