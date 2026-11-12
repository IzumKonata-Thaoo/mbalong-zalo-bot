import sharp from "sharp";
import { chickenPower, upgradeCost } from "./chicken-rules.js";
import { formatBetAmount } from "./tai-xiu-rules.js";

interface ChickenImageData {
  zalo_id: string;
  name: string;
  level: number;
  aggression: number;
  claws: number;
  comb: number;
  kick_power: number;
  wins: number;
  losses: number;
}

export interface ChickenEquipmentVisual {
  id: string;
  name: string;
  powerBonus: number;
  color: string;
  accent: string;
}

const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

function colorIndex(value: string) {
  let hash = 0;
  for (const char of value) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash;
}

export async function renderChickenImage(
  chicken: ChickenImageData,
  ownerName: string,
  equipment?: ChickenEquipmentVisual,
) {
  const palettes = [
    ["#f59e0b", "#b45309", "#fde68a"],
    ["#ef4444", "#991b1b", "#fecaca"],
    ["#60a5fa", "#1d4ed8", "#bfdbfe"],
    ["#a78bfa", "#6d28d9", "#ddd6fe"],
    ["#34d399", "#047857", "#a7f3d0"],
  ];
  const [primary, dark, light] = palettes[colorIndex(chicken.zalo_id) % palettes.length]!;
  const power = chickenPower(chicken, equipment?.powerBonus ?? 0);
  const clawColor = equipment?.color ?? "#f59e0b";
  const clawAccent = equipment?.accent ?? "#fde68a";
  const equipmentLabel = equipment?.name ?? "Móng nguyên bản";
  const scaleMax = Math.max(100, chicken.aggression, chicken.claws, chicken.comb, chicken.kick_power);
  const stats = [
    ["ĐỘ SUNG", chicken.aggression, "#fb7185"],
    ["MÓNG GÀ", chicken.claws, "#fbbf24"],
    ["MÀO GÀ", chicken.comb, "#f43f5e"],
    ["LỰC ĐÁ", chicken.kick_power, "#22d3ee"],
  ] as const;
  const bars = stats.map(([label, value, color], index) => {
    const y = 263 + index * 79;
    const width = Math.max(8, Math.round(value / scaleMax * 410));
    return `<text x="730" y="${y}" fill="#94a3b8" font-size="18" font-family="Arial" font-weight="700">${label}</text>
      <text x="1145" y="${y}" text-anchor="end" fill="#f8fafc" font-size="21" font-family="Arial" font-weight="800">${value}</text>
      <rect x="730" y="${y + 14}" width="415" height="14" rx="7" fill="#1e293b"/>
      <rect x="730" y="${y + 14}" width="${width}" height="14" rx="7" fill="${color}"/>`;
  }).join("");
  const crown = chicken.level >= 5
    ? `<path d="M340 148 L375 92 L410 148 L454 92 L490 148 Z" fill="#facc15" stroke="#fef08a" stroke-width="6"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07111f"/><stop offset="1" stop-color="#172033"/></linearGradient>
      <radialGradient id="aura"><stop stop-color="${primary}" stop-opacity=".42"/><stop offset="1" stop-color="${primary}" stop-opacity="0"/></radialGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="13" stdDeviation="13" flood-opacity=".45"/></filter>
    </defs>
    <rect width="1280" height="720" rx="28" fill="url(#bg)"/>
    <circle cx="390" cy="365" r="300" fill="url(#aura)"/>
    <text x="54" y="62" fill="#f8fafc" font-family="Arial" font-size="28" font-weight="900">MBA LONG · TRẠI GÀ CHIẾN</text>
    <text x="1226" y="58" text-anchor="end" fill="${light}" font-family="Arial" font-size="22" font-weight="800">LEVEL ${chicken.level}</text>
    ${crown}
    <g filter="url(#shadow)">
      <path d="M257 390 C162 330 135 234 176 190 C206 262 244 273 296 279 C229 205 249 145 291 117 C301 195 337 229 377 254 C365 167 414 126 459 122 C434 194 450 239 480 282" fill="none" stroke="${dark}" stroke-width="48" stroke-linecap="round"/>
      <ellipse cx="398" cy="394" rx="183" ry="139" fill="${primary}" stroke="${light}" stroke-width="9"/>
      <ellipse cx="430" cy="407" rx="100" ry="75" fill="${dark}" opacity=".48"/>
      <circle cx="530" cy="264" r="82" fill="${primary}" stroke="${light}" stroke-width="8"/>
      <path d="M491 190 C493 143 530 130 545 177 C559 127 598 143 585 195" fill="#ef4444" stroke="#fecaca" stroke-width="6"/>
      <path d="M592 267 L670 300 L590 320 Z" fill="#fbbf24" stroke="#fef3c7" stroke-width="6"/>
      <circle cx="554" cy="250" r="13" fill="#020617"/><circle cx="558" cy="245" r="4" fill="#fff"/>
      <path d="M530 330 C575 349 585 387 540 403 C510 378 500 349 530 330" fill="#dc2626"/>
      <path d="M335 511 L315 620 M465 512 L493 620" stroke="${clawColor}" stroke-width="18" stroke-linecap="round"/>
      <path d="M315 620 L251 649 M315 620 L320 672 M315 620 L376 651 M493 620 L430 655 M493 620 L502 674 M493 620 L556 647" stroke="${clawAccent}" stroke-width="14" stroke-linecap="round"/>
    </g>
    <rect x="690" y="110" width="520" height="530" rx="24" fill="#0f172a" stroke="#334155" stroke-width="2"/>
    <text x="730" y="167" fill="#f8fafc" font-family="Arial" font-size="36" font-weight="900">${escapeXml(chicken.name)}</text>
    <text x="730" y="201" fill="#64748b" font-family="Arial" font-size="17">Chủ kê: ${escapeXml(ownerName)} · ${escapeXml(equipmentLabel)}</text>
    ${bars}
    <line x1="730" y1="587" x2="1145" y2="587" stroke="#334155"/>
    <text x="730" y="622" fill="#94a3b8" font-family="Arial" font-size="18">LỰC CHIẾN</text>
    <text x="1145" y="624" text-anchor="end" fill="${light}" font-family="Arial" font-size="30" font-weight="900">${power.toLocaleString("vi-VN")}</text>
    <text x="54" y="685" fill="#94a3b8" font-family="Arial" font-size="18">Thành tích: ${chicken.wins} thắng · ${chicken.losses} thua</text>
    <text x="1226" y="685" text-anchor="end" fill="#94a3b8" font-family="Arial" font-size="18">Nâng cấp kế: ${escapeXml(formatBetAmount(upgradeCost(chicken.level)))}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
