import { randomInt } from "node:crypto";
import { repository } from "../db.js";
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
export function handleTaiXiu(senderId: string, input: string): string | null {
  const command = parseTaiXiu(input);
  if (!command) return null;
  const currentBalance = repository.walletBalance(senderId);
  const guide = `Cách chơi: @MbaLong /tx tài 1000\nhoặc: @MbaLong /tx xỉu 1000\n\nXem số dư: @MbaLong /sodu\nChỉ nhập số nguyên, không kèm đơn vị tiền tệ.`;
  if (command.kind === "help") return `🎲 TÀI XỈU · MBALONG\n\nSố dư: ${formatBetAmount(currentBalance)}\n\n${guide}`;
  if (command.kind === "invalid") return `⚠️ Cú pháp chưa đúng.\n\n${guide}`;
  if (command.amount <= 0n) return "Mức cược phải là số nguyên dương hợp lệ.";
  if (currentBalance < command.amount)
    return `Số dư không đủ.\n\nSố dư: ${formatBetAmount(currentBalance)}\nMức cược: ${formatBetAmount(command.amount)}`;
  const dice = rollDice(),
    outcome = resolveTaiXiu(dice);
  const won = outcome === command.choice;
  const settlement = repository.settleTaiXiu(senderId, command.amount, won);
  if (!settlement.ok)
    return `Số dư không đủ. Số dư hiện tại: ${formatBetAmount(settlement.balance)}.`;
  const label =
    outcome === "triple"
      ? "BỘ BA · NHÀ CÁI THẮNG"
      : outcome === "tai"
        ? "TÀI"
        : "XỈU";
  const faces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  return `🎲 TÀI XỈU · KẾT QUẢ\n\n${dice.map((d) => `${faces[d] ?? "🎲"} ${d}`).join("  ")}\nTổng: ${dice[0] + dice[1] + dice[2]} · ${label}\n\n${won ? "✅ THẮNG" : "❌ THUA"} · Mức cược ${formatBetAmount(command.amount)}\nBiến động: ${won ? "+" : "−"}${formatBetAmount(command.amount)}\nSố dư mới: ${formatBetAmount(settlement.balance)}`;
}
