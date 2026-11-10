import { repository } from "../db.js";
import type { IncomingGroupMessage } from "../types.js";
import { formatBetAmount } from "./tai-xiu-rules.js";
import { parseWalletCommand } from "./wallet-rules.js";

const adjustGuide = [
  "Cách dùng admin:",
  "• @MbaLong /nap 10000 — cộng cho chính admin",
  "• @MbaLong @NgườiDùng /nap 10000",
  "• @MbaLong /nap ZALO_ID 10000",
  "• Đổi /nap thành /tru để trừ số dư",
].join("\n");

const transferGuide = [
  "Cách chuyển tiền:",
  "• @MbaLong @NgườiNhận /chuyen 10000",
  "• @MbaLong /chuyen ZALO_ID 10000",
].join("\n");

export interface WalletDeps {
  botIds: ReadonlySet<string>;
  isAdmin(message: IncomingGroupMessage): Promise<boolean>;
  findMember(groupId: string, zaloId: string): Promise<string>;
}

export async function handleWalletCommand(
  message: IncomingGroupMessage,
  input: string,
  deps: WalletDeps,
): Promise<string | null> {
  const command = parseWalletCommand(input);
  if (!command) return null;
  if (command.kind === "balance") {
    const balance = repository.walletBalance(message.senderId);
    return `💰 SỐ DƯ\n\n${message.senderName}: ${formatBetAmount(balance)}`;
  }
  if (command.kind === "invalid")
    return `⚠️ Cú pháp chưa đúng.\n\n${adjustGuide}\n\n${transferGuide}`;

  const isBot = (id: string) =>
    deps.botIds.has(id) ||
    [...repository.identityIds(message.groupId, [id])].some((alias) =>
      deps.botIds.has(alias),
    );
  const mentionedTargets = [
    ...new Set(
      message.mentions
        .map((mention) => String(mention.uid ?? "").trim())
        .filter((uid) => uid && uid !== "-1" && !isBot(uid))
        .map((uid) => repository.resolveMemberId(message.groupId, [uid])),
    ),
  ];
  if (mentionedTargets.length > 1)
    return "Chỉ được chọn một tài khoản nhận trong mỗi lệnh.";
  if (command.explicitTargetId && mentionedTargets.length)
    return "Chỉ dùng một cách chọn người nhận: tag tài khoản hoặc nhập Zalo ID.";

  let targetId: string;
  if (command.explicitTargetId) {
    const found = await deps.findMember(
      message.groupId,
      command.explicitTargetId,
    );
    targetId = found
      ? repository.resolveMemberId(message.groupId, [found])
      : "";
    if (!targetId)
      return "Không tìm thấy Zalo ID này trong nhóm. Hãy tag trực tiếp người đó, hoặc bấm Làm mới thành viên trên web admin.";
  } else {
    targetId =
      mentionedTargets[0] ??
      (command.kind === "adjust" ? message.senderId : "");
  }
  if (!targetId)
    return command.kind === "transfer"
      ? `Chưa xác định được người nhận.\n\n${transferGuide}`
      : "Không xác định được Zalo ID của người nhận.";

  if (command.kind === "transfer") {
    if (isBot(targetId)) return "Không thể chuyển tiền cho tài khoản bot.";
    if (targetId === message.senderId)
      return "Không thể chuyển tiền cho chính mình.";
    const result = repository.transferWalletBalance(
      message.senderId,
      targetId,
      command.amount,
    );
    if (!result.ok)
      return result.reason === "insufficient"
        ? `Số dư không đủ.\n\nSố dư hiện tại: ${formatBetAmount(result.senderBalance)}\nSố tiền muốn chuyển: ${formatBetAmount(command.amount)}`
        : "Không thể thực hiện giao dịch này.";
    const member = repository.member(message.groupId, targetId);
    const mentionName = mentionedTargets.length
      ? mentionText(message, (uid) => !isBot(uid))
      : "";
    const targetName =
      member?.display_name ?? (mentionName || `Zalo ${targetId}`);
    repository.audit(message.senderId, "wallet.transfer", targetId, {
      groupId: message.groupId,
      amount: command.amount.toString(),
      senderBalanceBefore: result.senderPrevious.toString(),
      senderBalanceAfter: result.senderBalance.toString(),
      recipientBalanceBefore: result.recipientPrevious.toString(),
      recipientBalanceAfter: result.recipientBalance.toString(),
    });
    return `💸 CHUYỂN TIỀN THÀNH CÔNG\n\nNgười gửi: ${message.senderName}\nNgười nhận: ${targetName}\nSố tiền: ${formatBetAmount(command.amount)}\n\nSố dư người gửi: ${formatBetAmount(result.senderBalance)}\nSố dư người nhận: ${formatBetAmount(result.recipientBalance)}`;
  }

  if (!(await deps.isAdmin(message)))
    return "Bạn không có quyền thực hiện lệnh này. Chỉ trưởng nhóm, phó nhóm hoặc Zalo ID trong ZALO_ADMIN_IDS được cộng/trừ số dư.";

  const member = repository.member(message.groupId, targetId);
  const delta = command.operation === "add" ? command.amount : -command.amount;
  const result = repository.adjustWalletBalance(targetId, delta);
  if (!result.ok)
    return `Không thể trừ ${formatBetAmount(command.amount)} vì số dư hiện tại chỉ có ${formatBetAmount(result.balance)}.`;

  const mentionName = mentionedTargets.length
    ? mentionText(message, (uid) => !isBot(uid))
    : "";
  const targetName =
    member?.display_name ??
    (targetId === message.senderId
      ? message.senderName
      : mentionName || `Zalo ${targetId}`);
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

function mentionText(
  message: IncomingGroupMessage,
  accept: (uid: string) => boolean,
) {
  const last = message.mentions.find(
    (m) =>
      accept(String(m.uid ?? "")) &&
      Number.isInteger(m.pos) &&
      Number.isInteger(m.len),
  );
  if (!last) return "";
  return message.content
    .slice(last.pos, (last.pos ?? 0) + (last.len ?? 0))
    .replace(/^@/, "")
    .trim();
}
