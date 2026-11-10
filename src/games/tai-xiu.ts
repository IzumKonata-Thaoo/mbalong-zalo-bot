import { randomInt } from "node:crypto";
import { repository } from "../db.js";
import {
  type TaiXiuChoice,
  formatBetAmount,
  parseTaiXiu,
  resolveTaiXiu,
} from "./tai-xiu-rules.js";
import { configuredWin, getGameSettings } from "./game-settings.js";
import { resolveJackpot, resolveWipeout } from "./jackpot.js";

export function rollDice() {
  return [randomInt(1, 7), randomInt(1, 7), randomInt(1, 7)] as [
    number,
    number,
    number,
  ];
}

export function rollDiceForResult(choice: TaiXiuChoice, won: boolean) {
  for (;;) {
    const dice = rollDice();
    if ((resolveTaiXiu(dice) === choice) === won) return dice;
  }
}

export function handleTaiXiu(
  senderId: string,
  input: string,
  senderName = `Zalo ${senderId.slice(-6)}`,
): string | null {
  const command = parseTaiXiu(input);
  if (!command) return null;
  const currentBalance = repository.walletBalance(senderId);
  const guide = `Cách chơi: @MbaLong /tx tài 1000\nhoặc: @MbaLong /tx xỉu 1000\n\nXem số dư: @MbaLong /sodu\nBảng xếp hạng: @MbaLong /bxh\nChỉ nhập số nguyên, không kèm đơn vị tiền tệ.`;
  if (command.kind === "help") return `🎲 TÀI XỈU · MBALONG\n\nSố dư: ${formatBetAmount(currentBalance)}\n\n${guide}`;
  if (command.kind === "invalid") return `⚠️ Cú pháp chưa đúng.\n\n${guide}`;
  if (command.amount <= 0n) return "Mức cược phải là số nguyên dương hợp lệ.";
  if (currentBalance < command.amount)
    return `Số dư không đủ.\n\nSố dư: ${formatBetAmount(currentBalance)}\nMức cược: ${formatBetAmount(command.amount)}`;
  const settings = getGameSettings();
  const won = configuredWin(settings.taiXiuWinRate);
  const dice = rollDiceForResult(command.choice, won),
    outcome = resolveTaiXiu(dice);
  if (resolveWipeout(settings)) {
    const wiped = repository.wipeWalletBalance(senderId);
    repository.recordGameResult(senderId, senderName, -wiped.previous);
    repository.audit(senderId, "game.wipeout", "tai-xiu", {
      balanceBefore: wiped.previous.toString(),
      balanceAfter: "0",
    });
    return `💣 HŨ CHÁY VÍ · TÀI XỈU\n\nToàn bộ số dư đã bị trừ.\nBiến động: −${formatBetAmount(wiped.previous)}\nSố dư mới: 0`;
  }
  const jackpot = resolveJackpot(won ? command.amount : -command.amount, settings);
  const settlement = repository.settleTaiXiu(
    senderId,
    command.amount,
    won,
    senderName,
    jackpot.profit,
  );
  if (!settlement.ok)
    return `Số dư không đủ. Số dư hiện tại: ${formatBetAmount(settlement.balance)}.`;
  const label =
    outcome === "triple"
      ? "BỘ BA · NHÀ CÁI THẮNG"
      : outcome === "tai"
        ? "TÀI"
        : "XỈU";
  const faces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  return `🎲 TÀI XỈU · KẾT QUẢ\n\n${dice.map((d) => `${faces[d] ?? "🎲"} ${d}`).join("  ")}\nTổng: ${dice[0] + dice[1] + dice[2]} · ${label}\n\n${won ? "✅ THẮNG" : "❌ THUA"} · Mức cược ${formatBetAmount(command.amount)}${jackpot.hit ? `\n💥 NỔ HŨ · Thưởng ${formatBetAmount(jackpot.profit)}` : ""}\nBiến động: ${won ? "+" : "−"}${formatBetAmount(won ? jackpot.profit : command.amount)}\nSố dư mới: ${formatBetAmount(settlement.balance)}`;
}
