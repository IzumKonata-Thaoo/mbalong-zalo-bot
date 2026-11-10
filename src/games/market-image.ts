import sharp from "sharp";
import {
  formatMarketPrice,
  marketSymbolLabel,
  marketCandles,
  marketPriceAt,
  type VirtualMarket,
} from "./market-rules.js";

const WIDTH = 1280;
const HEIGHT = 720;

export async function renderMarketImage(
  market: VirtualMarket,
  now = Date.now(),
): Promise<Buffer> {
  const candles = marketCandles(market, now, 64, 60);
  const current = marketPriceAt(market, now);
  const first = candles[0]?.open ?? current;
  const change = current - first;
  const changePercent = first ? change / first * 100 : 0;
  const positive = change >= 0;
  const allHigh = candles.map((candle) => candle.high);
  const allLow = candles.map((candle) => candle.low);
  let maxPrice = Math.max(...allHigh, current);
  let minPrice = Math.min(...allLow, current);
  const padding = Math.max(80, Math.round((maxPrice - minPrice) * 0.12));
  maxPrice += padding;
  minPrice -= padding;

  const chart = { x: 32, y: 148, width: 840, height: 462 };
  const volumeHeight = 80;
  const priceHeight = chart.height - volumeHeight;
  const candleWidth = chart.width / Math.max(candles.length, 1);
  const yFor = (price: number) =>
    chart.y + (maxPrice - price) / Math.max(1, maxPrice - minPrice) * priceHeight;
  const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);

  const grid = Array.from({ length: 7 }, (_, index) => {
    const y = chart.y + index * priceHeight / 6;
    const price = maxPrice - index * (maxPrice - minPrice) / 6;
    return `<line x1="${chart.x}" y1="${y}" x2="970" y2="${y}" stroke="#253044" stroke-width="1" opacity=".65"/>
      <text x="888" y="${y - 7}" fill="#8c98aa" font-size="16">${formatMarketPrice(Math.round(price))}</text>`;
  }).join("");

  const candleSvg = candles.map((candle, index) => {
    const x = chart.x + index * candleWidth + candleWidth / 2;
    const up = candle.close >= candle.open;
    const color = up ? "#16c784" : "#ea3943";
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(2, Math.abs(closeY - openY));
    const volume = candle.volume / maxVolume * (volumeHeight - 8);
    return `<line x1="${x}" y1="${yFor(candle.high)}" x2="${x}" y2="${yFor(candle.low)}" stroke="${color}" stroke-width="2"/>
      <rect x="${x - candleWidth * .29}" y="${bodyY}" width="${candleWidth * .58}" height="${bodyHeight}" rx="1" fill="${color}"/>
      <rect x="${x - candleWidth * .3}" y="${chart.y + chart.height - volume}" width="${candleWidth * .6}" height="${volume}" fill="${color}" opacity=".32"/>`;
  }).join("");

  const currentY = yFor(current);
  const remaining = Math.max(0, market.sessionEnd - now);
  const remainingHours = Math.floor(remaining / 3_600_000);
  const remainingMinutes = Math.floor(remaining % 3_600_000 / 60_000);
  const timeLabels = [0, 16, 32, 48, 63].map((index) => {
    const candle = candles[Math.min(index, candles.length - 1)];
    if (!candle) return "";
    const label = new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(candle.time);
    const x = chart.x + index * candleWidth + candleWidth / 2;
    return `<text x="${x}" y="650" fill="#7d899b" font-size="15" text-anchor="middle">${label}</text>`;
  }).join("");

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#080d16"/></linearGradient>
      <linearGradient id="long" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#18c785"/><stop offset="1" stop-color="#087f58"/></linearGradient>
      <linearGradient id="short" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f04451"/><stop offset="1" stop-color="#a91f2a"/></linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-opacity=".3"/></filter>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)"/>
    <rect width="1280" height="78" fill="#0d1420"/>
    <line x1="0" y1="78" x2="1280" y2="78" stroke="#293446"/>
    <circle cx="34" cy="38" r="18" fill="#f1b94b"/><text x="34" y="45" text-anchor="middle" font-family="Arial" font-weight="700" font-size="18" fill="#131820">M</text>
    <text x="64" y="34" font-family="Arial" font-weight="700" font-size="24" fill="#f4f7fb">${marketSymbolLabel(market.symbol)} Virtual</text>
    <text x="64" y="58" font-family="Arial" font-size="14" fill="#7f8b9d">MBA LONG • THỊ TRƯỜNG ẢO</text>
    <text x="315" y="35" font-family="Arial" font-weight="700" font-size="28" fill="${positive ? "#16c784" : "#ea3943"}">${formatMarketPrice(current)}</text>
    <text x="315" y="59" font-family="Arial" font-size="16" fill="${positive ? "#16c784" : "#ea3943"}">${positive ? "+" : ""}${formatMarketPrice(change)}  ${positive ? "+" : ""}${changePercent.toFixed(2)}%</text>
    <text x="568" y="28" font-family="Arial" font-size="13" fill="#7f8b9d">GIÁ ĐÁNH DẤU</text><text x="568" y="53" font-family="Arial" font-size="17" fill="#dbe2ec">${formatMarketPrice(current + 2)}</text>
    <text x="730" y="28" font-family="Arial" font-size="13" fill="#7f8b9d">PHIÊN CÒN LẠI</text><text x="730" y="53" font-family="Arial" font-size="17" fill="#f1b94b">${remainingHours}h ${remainingMinutes}m</text>
    <text x="905" y="28" font-family="Arial" font-size="13" fill="#7f8b9d">ĐÒN BẨY</text><text x="905" y="53" font-family="Arial" font-size="17" fill="#dbe2ec">TÙY CHỌN</text>
    <text x="1080" y="28" font-family="Arial" font-size="13" fill="#7f8b9d">CHẾ ĐỘ</text><text x="1080" y="53" font-family="Arial" font-size="17" fill="#dbe2ec">ISOLATED</text>

    <rect x="0" y="79" width="1280" height="52" fill="#101824"/>
    <text x="26" y="112" font-family="Arial" font-size="17" fill="#8995a7">Khung</text>
    <rect x="92" y="91" width="55" height="30" rx="7" fill="#263247"/><text x="119" y="112" text-anchor="middle" font-family="Arial" font-weight="700" font-size="15" fill="#fff">1m</text>
    <text x="170" y="112" font-family="Arial" font-size="15" fill="#6f7c90">5m</text><text x="218" y="112" font-family="Arial" font-size="15" fill="#6f7c90">15m</text>
    <text x="292" y="112" font-family="Arial" font-size="14" fill="#f1b94b">Dữ liệu mô phỏng • Không phải giá thật</text>

    ${grid}
    ${candleSvg}
    <line x1="${chart.x}" y1="${currentY}" x2="970" y2="${currentY}" stroke="${positive ? "#16c784" : "#ea3943"}" stroke-width="1.5" stroke-dasharray="5 5" opacity=".75"/>
    <rect x="874" y="${currentY - 18}" width="94" height="32" rx="5" fill="${positive ? "#16c784" : "#ea3943"}"/>
    <text x="921" y="${currentY + 4}" text-anchor="middle" font-family="Arial" font-weight="700" font-size="16" fill="#fff">${formatMarketPrice(current)}</text>
    ${timeLabels}

    <g filter="url(#shadow)"><rect x="982" y="248" width="245" height="78" rx="14" fill="url(#long)"/><text x="1104" y="297" text-anchor="middle" font-family="Arial" font-weight="800" font-size="31" fill="#fff">↗ LONG</text></g>
    <g filter="url(#shadow)"><rect x="982" y="354" width="245" height="78" rx="14" fill="url(#short)"/><text x="1104" y="403" text-anchor="middle" font-family="Arial" font-weight="800" font-size="31" fill="#fff">↘ SHORT</text></g>
    <text x="1104" y="472" text-anchor="middle" font-family="Arial" font-size="15" fill="#8d99aa">/long ${market.symbol} số_tiền 10x</text>
    <text x="1104" y="498" text-anchor="middle" font-family="Arial" font-size="15" fill="#8d99aa">/short ${market.symbol} số_tiền 10x</text>
    <text x="24" y="696" font-family="Arial" font-size="13" fill="#687489">Giá được tạo trước cho toàn phiên 5 giờ; lệnh của người chơi không làm thay đổi thị trường.</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
