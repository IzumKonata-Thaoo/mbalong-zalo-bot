import { randomInt } from "node:crypto";
import {
  formatBetAmount,
  parseTaiXiu,
  resolveTaiXiu,
} from "./tai-xiu-rules.js";

export function rollDice() {
  return [randomInt(1, 7), randomInt(1, 7), randomInt(1, 7)] as [
    number,
    number,
    number,
  ];
}
export function handleTaiXiu(input: string): string | null {
  const command = parseTaiXiu(input);
  if (!command) return null;
  const guide = `Cách chơi: @MbaLong /tx tài 1000\nhoặc: @MbaLong /tx xỉu 1000\n\nChỉ nhập số nguyên, không kèm đơn vị tiền tệ.`;
  if (command.kind === "help") return `🎲 TÀI XỈU · MBALONG\n\n${guide}`;
  if (command.kind === "invalid") return `⚠️ Cú pháp chưa đúng.\n\n${guide}`;
  if (command.amount <= 0n) return "Mức cược phải là số nguyên dương hợp lệ.";
  const dice = rollDice(),
    outcome = resolveTaiXiu(dice);
  const won = outcome === command.choice;
  const label =
    outcome === "triple"
      ? "BỘ BA · NHÀ CÁI THẮNG"
      : outcome === "tai"
        ? "TÀI"
        : "XỈU";
  const faces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  return `🎲 TÀI XỈU · KẾT QUẢ\n\n${dice.map((d) => `${faces[d] ?? "🎲"} ${d}`).join("  ")}\nTổng: ${dice[0] + dice[1] + dice[2]} · ${label}\n\n${won ? "✅ THẮNG" : "❌ THUA"} · Mức cược ${formatBetAmount(command.amount)}`;
}
