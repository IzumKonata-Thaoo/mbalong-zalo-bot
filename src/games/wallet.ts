import { config } from "../config.js";
import { repository } from "../db.js";
import type { IncomingGroupMessage } from "../types.js";
import { formatBetAmount } from "./tai-xiu-rules.js";
import { parseWalletCommand } from "./wallet-rules.js";

const adjustGuide =
  "Cách dùng admin:\n" +
  "• @MbaLong /nap 10000 — cộng cho chính admin\n" +
  "• @MbaLong @NgườiDùng /nap 10000\n" +
  "• @MbaLong /nap ZALO_ID 10000\n" +
  "• Đổi /nap thành /tru để trừ số dư";

export function handleWalletCommand(
  message: IncomingGroupMessage,
  input: string,
  botId: string,
): string | null {
  const command = parseWalletCommand(input);
  if (!command) return null;
  if (command.kind === "balance") {
    const balance = repository.walletBalance(message.senderId);
    return `💰 SỐ DƯ\n\n${message.senderName}: ${formatBetAmount(balance)}`;
  }
  if (!config.adminIds.has(message.senderId))
    return "Bạn không có quyền cộng hoặc trừ số dư.";
  if (command.kind === "invalid") return `⚠️ Cú pháp chưa đúng.\n\n${adjustGuide}`;

  const mentionedTargets = [
    ...new Set(
      message.mentions
        .map((mention) => String(mention.uid ?? ""))
        .filter((id) => id && id !== botId),
    ),
  ];
  if (mentionedTargets.length > 1)
    return "Chỉ được chỉnh số dư cho một tài khoản mỗi lệnh.";
  if (command.explicitTargetId && mentionedTargets.length)
    return "Chỉ dùng một cách chọn người nhận: tag tài khoản hoặc nhập Zalo ID.";

  const targetId =
    command.explicitTargetId ?? mentionedTargets[0] ?? message.senderId;
  const member = repository.member(message.groupId, targetId);
  if (targetId !== message.senderId && !member)
    return "Không tìm thấy Zalo ID này trong danh sách thành viên nhóm. Hãy tag người đó hoặc làm mới member trên web admin.";

  const delta = command.operation === "add" ? command.amount : -command.amount;
  const result = repository.adjustWalletBalance(targetId, delta);
  if (!result.ok)
    return `Không thể trừ ${formatBetAmount(command.amount)} vì số dư hiện tại chỉ có ${formatBetAmount(result.balance)}.`;

  const targetName = member?.display_name ??
    (targetId === message.senderId ? message.senderName : `Zalo ${targetId}`);
  repository.audit(
    message.senderId,
    command.operation === "add" ? "wallet.credit" : "wallet.debit",
    targetId,
    {
      groupId: message.groupId,
      amount: command.amount.toString(),
      balanceBefore: result.previous.toString(),
      balanceAfter: result.balance.toString(),
    },
  );
  const action = command.operation === "add" ? "CỘNG SỐ DƯ" : "TRỪ SỐ DƯ";
  return `💳 ${action}\n\nTài khoản: ${targetName}\nZalo ID: ${targetId}\nSố tiền: ${formatBetAmount(command.amount)}\nSố dư mới: ${formatBetAmount(result.balance)}`;
}
