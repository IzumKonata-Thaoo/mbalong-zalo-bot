import { repository } from "../db.js";
import { formatBetAmount } from "./tai-xiu-rules.js";

export function isLeaderboardCommand(input: string) {
  return /^\/(?:bxh|top|xephang)\s*$/i.test(input.trim());
}

export function leaderboardMessage(limit = 10) {
  const rows = repository.gameLeaderboard(limit);
  if (!rows.length)
    return "🏆 BẢNG XẾP HẠNG\n\nChưa có kết quả game nào. Dữ liệu sẽ được tính từ các ván mới.";
  const medals = ["🥇", "🥈", "🥉"];
  return [
    "🏆 BẢNG XẾP HẠNG THẮNG LỚN",
    "Tài xỉu + Long/Short",
    "",
    ...rows.map((row, index) => {
      const net = BigInt(row.net_profit);
      const netText = `${net > 0n ? "+" : net < 0n ? "−" : ""}${formatBetAmount(net < 0n ? -net : net)}`;
      return [
        `${medals[index] ?? `${index + 1}.`} ${row.display_name}`,
        `   Tổng thắng: ${formatBetAmount(BigInt(row.total_winnings))} · Lãi ròng: ${netText}`,
        `   Thắng ${row.games_won}/${row.games_played} ván`,
      ].join("\n");
    }),
    "",
    "Chỉ tính kết quả game, không tính tiền admin nạp/trừ.",
  ].join("\n");
}
