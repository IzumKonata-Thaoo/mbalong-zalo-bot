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

export interface WalletDeps {
  /** Every ID that belongs to the bot account (login UID and its aliases). */
  botIds: ReadonlySet<string>;
  /** Live owner/deputy/ZALO_ADMIN_IDS check for the sender. */
  isAdmin(message: IncomingGroupMessage): Promise<boolean>;
  /** Resolves an explicit Zalo ID to the canonical member ID, or "" if not in the group. */
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
  if (!(await deps.isAdmin(message)))
    return "Bạn không có quyền thực hiện lệnh này. Chỉ trưởng nhóm, phó nhóm hoặc Zalo ID trong ZALO_ADMIN_IDS được cộng/trừ số dư.";
  if (command.kind === "invalid") return `⚠️ Cú pháp chưa đúng.\n\n${adjustGuide}`;

  const isBot = (id: string) =>
    deps.botIds.has(id) ||
    [...repository.identityIds(message.groupId, [id])].some((alias) => deps.botIds.has(alias));
  const mentionedTargets = [
    ...new Set(
      message.mentions
        .map((mention) => String(mention.uid ?? "").trim())
        .filter((uid) => uid && uid !== "-1" && !isBot(uid))
        .map((uid) => repository.resolveMemberId(message.groupId, [uid])),
    ),
  ];
  if (mentionedTargets.length > 1)
    return "Chỉ được chỉnh số dư cho một tài khoản mỗi lệnh.";
  if (command.explicitTargetId && mentionedTargets.length)
    return "Chỉ dùng một cách chọn người nhận: tag tài khoản hoặc nhập Zalo ID.";

  let targetId: string;
  if (command.explicitTargetId) {
    // A typed ID must belong to someone in this group; a tag already proves it.
    targetId = await deps.findMember(message.groupId, command.explicitTargetId);
    if (!targetId)
      return "Không tìm thấy Zalo ID này trong nhóm. Hãy tag trực tiếp người đó, hoặc bấm Làm mới thành viên trên web admin.";
  } else {
    targetId = mentionedTargets[0] ?? message.senderId;
  }
  if (!targetId) return "Không xác định được Zalo ID của người nhận.";
  const member = repository.member(message.groupId, targetId);

  const delta = command.operation === "add" ? command.amount : -command.amount;
  const result = repository.adjustWalletBalance(targetId, delta);
  if (!result.ok)
    return `Không thể trừ ${formatBetAmount(command.amount)} vì số dư hiện tại chỉ có ${formatBetAmount(result.balance)}.`;

  const mentionName = mentionedTargets.length
    ? mentionText(message, (uid) => !isBot(uid))
    : "";
  const targetName = member?.display_name ??
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

/** Display text of the non-bot mention (e.g. "@Hạ My" → "Hạ My"). */
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
