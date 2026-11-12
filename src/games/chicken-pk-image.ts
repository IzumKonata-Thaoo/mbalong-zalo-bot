import sharp from "sharp";
import { chickenPower } from "./chicken-rules.js";
import type { ChickenEquipmentVisual, ChickenImageData } from "./chicken-image.js";
import { formatBetAmount } from "./tai-xiu-rules.js";

interface Fighter {
  chicken: ChickenImageData;
  ownerName: string;
  equipment: ChickenEquipmentVisual;
  score?: number;
}

interface PkBannerInput {
  left: Fighter;
  right: Fighter;
  state: "challenge" | "result";
  winnerId?: string;
  stake: bigint;
}

const palettes = [
  ["#f59e0b", "#b45309", "#fde68a"],
  ["#ef4444", "#991b1b", "#fecaca"],
  ["#60a5fa", "#1d4ed8", "#bfdbfe"],
  ["#a78bfa", "#6d28d9", "#ddd6fe"],
  ["#34d399", "#047857", "#a7f3d0"],
] as const;

const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

function colorIndex(value: string) {
  let hash = 0;
  for (const char of value) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash;
}

function fighterCard(fighter: Fighter, x: number, side: "left" | "right", state: PkBannerInput["state"], winnerId?: string) {
  const [primary, dark, light] = palettes[colorIndex(fighter.chicken.zalo_id) % palettes.length]!;
  const won = winnerId === fighter.chicken.zalo_id;
  const status = state === "challenge" ? "SẴN SÀNG" : won ? "CHIẾN THẮNG" : "THẤT BẠI";
  const statusColor = state === "challenge" ? "#fbbf24" : won ? "#86efac" : "#fda4af";
  const power = chickenPower(fighter.chicken, fighter.equipment.powerBonus);
  const mirror = side === "right" ? `translate(${x + 430} 0) scale(-1 1) translate(${-x} 0)` : "";
  const chickenX = x + 215;
  return `
    <rect x="${x}" y="126" width="430" height="470" rx="26" fill="#111318" stroke="${won && state === "result" ? "#22c55e" : "#3f3f46"}" stroke-width="${won && state === "result" ? 5 : 2}"/>
    <g transform="${mirror}">
      <path d="M${chickenX - 118} 307 C${chickenX - 180} 260 ${chickenX - 178} 205 ${chickenX - 145} 181 C${chickenX - 135} 225 ${chickenX - 100} 238 ${chickenX - 72} 250 C${chickenX - 92} 198 ${chickenX - 56} 167 ${chickenX - 22} 166 C${chickenX - 38} 213 ${chickenX - 22} 247 ${chickenX + 3} 265" fill="none" stroke="${dark}" stroke-width="34" stroke-linecap="round"/>
      <ellipse cx="${chickenX}" cy="327" rx="128" ry="92" fill="${primary}" stroke="${light}" stroke-width="7"/>
      <ellipse cx="${chickenX + 22}" cy="338" rx="66" ry="48" fill="${dark}" opacity=".55"/>
      <circle cx="${chickenX + 95}" cy="236" r="58" fill="${primary}" stroke="${light}" stroke-width="6"/>
      <path d="M${chickenX + 70} 188 C${chickenX + 73} 154 ${chickenX + 98} 148 ${chickenX + 107} 180 C${chickenX + 119} 146 ${chickenX + 145} 160 ${chickenX + 135} 193" fill="#ef4444" stroke="#fecaca" stroke-width="5"/>
      <path d="M${chickenX + 138} 236 L${chickenX + 190} 258 L${chickenX + 137} 276 Z" fill="#fbbf24" stroke="#fef3c7" stroke-width="5"/>
      <circle cx="${chickenX + 111}" cy="228" r="9" fill="#020617"/><circle cx="${chickenX + 114}" cy="225" r="3" fill="#fff"/>
      <path d="M${chickenX - 38} 408 L${chickenX - 51} 470 M${chickenX + 44} 408 L${chickenX + 57} 470" stroke="${fighter.equipment.color}" stroke-width="14" stroke-linecap="round"/>
      <path d="M${chickenX - 51} 470 L${chickenX - 88} 491 M${chickenX - 51} 470 L${chickenX - 47} 501 M${chickenX - 51} 470 L${chickenX - 16} 491 M${chickenX + 57} 470 L${chickenX + 22} 493 M${chickenX + 57} 470 L${chickenX + 62} 502 M${chickenX + 57} 470 L${chickenX + 94} 489" stroke="${fighter.equipment.accent}" stroke-width="10" stroke-linecap="round"/>
    </g>
    <rect x="${x + 20}" y="146" width="154" height="34" rx="17" fill="#27272a"/>
    <text x="${x + 97}" y="169" text-anchor="middle" fill="${statusColor}" font-family="Arial" font-size="15" font-weight="900">${status}</text>
    <text x="${x + 215}" y="536" text-anchor="middle" fill="#fafafa" font-family="Arial" font-size="27" font-weight="900">${escapeXml(fighter.chicken.name)}</text>
    <text x="${x + 215}" y="566" text-anchor="middle" fill="#a1a1aa" font-family="Arial" font-size="16">${escapeXml(fighter.ownerName)} · ${escapeXml(fighter.equipment.name)}</text>
    <text x="${x + 24}" y="618" fill="#71717a" font-family="Arial" font-size="15">LEVEL ${fighter.chicken.level} · LC ${power.toLocaleString("vi-VN")}</text>
    ${fighter.score === undefined ? "" : `<text x="${x + 406}" y="618" text-anchor="end" fill="#fafafa" font-family="Arial" font-size="18" font-weight="900">${fighter.score.toLocaleString("vi-VN")} ĐIỂM</text>`}
  `;
}

function flames() {
  const xs = [32, 118, 205, 935, 1022, 1112, 1200];
  return xs.map((x, index) => {
    const h = 46 + (index % 3) * 14;
    return `<path d="M${x} 720 C${x - 25} ${720 - h / 2} ${x + 10} ${720 - h} ${x + 4} ${720 - h - 24} C${x + 44} ${720 - h / 2} ${x + 35} 690 ${x + 58} 720 Z" fill="#ea580c" opacity=".82"/>
      <path d="M${x + 13} 720 C${x - 1} 697 ${x + 22} ${700 - h / 2} ${x + 22} ${687 - h / 2} C${x + 45} 705 ${x + 34} 711 ${x + 47} 720 Z" fill="#fbbf24" opacity=".9"/>`;
  }).join("");
}

export async function renderChickenPkBanner(input: PkBannerInput) {
  const title = input.state === "challenge" ? "KÈO ĐÁ GÀ" : "KẾT QUẢ ĐÁ GÀ";
  const subtitle = input.state === "challenge"
    ? `MỖI BÊN ${formatBetAmount(input.stake).toUpperCase()}`
    : `TỔNG POT ${formatBetAmount(input.stake * 2n).toUpperCase()}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <rect width="1280" height="720" fill="#09090b"/>
    <path d="M0 0 H1280 V95 C1030 50 840 120 640 74 C430 25 270 112 0 65 Z" fill="#18181b"/>
    <text x="52" y="54" fill="#fafafa" font-family="Arial" font-size="25" font-weight="900">MBALONG · ${title}</text>
    <text x="1228" y="54" text-anchor="end" fill="#fbbf24" font-family="Arial" font-size="18" font-weight="800">${escapeXml(subtitle)}</text>
    ${fighterCard(input.left, 54, "left", input.state, input.winnerId)}
    ${fighterCard(input.right, 796, "right", input.state, input.winnerId)}
    <circle cx="640" cy="338" r="91" fill="#18181b" stroke="#f97316" stroke-width="6"/>
    <path d="M640 202 C600 258 626 278 598 313 C635 299 620 369 640 404 C662 369 647 329 685 301 C649 297 680 252 640 202 Z" fill="#ea580c"/>
    <path d="M641 254 C621 291 639 310 625 334 C648 324 643 361 641 374 C666 348 651 322 666 306 C649 304 660 278 641 254 Z" fill="#fbbf24"/>
    <text x="640" y="353" text-anchor="middle" fill="#fff" font-family="Arial" font-size="60" font-weight="900" stroke="#09090b" stroke-width="7" paint-order="stroke">VS</text>
    ${flames()}
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
