import { randomInt, randomUUID } from "node:crypto";
import { repository } from "../db.js";
import type { IncomingGroupMessage } from "../types.js";
import { renderChickenImage } from "./chicken-image.js";
import {
  battleScore,
  chickenGuide,
  chickenPower,
  parseChickenCommand,
  upgradeCost,
} from "./chicken-rules.js";
import { formatBetAmount } from "./tai-xiu-rules.js";

const CHALLENGE_TTL_MS = 5 * 60_000;
const lines = (...items: string[]) => items.join("\n");

export interface ChickenDeps {
  botIds: ReadonlySet<string>;
  isReplyToBot(message: IncomingGroupMessage): boolean;
}

export interface ChickenResponse {
  message: string;
  image?: Buffer;
  mention?: { uid: string; name: string };
}

export async function handleChickenCommand(
  message: IncomingGroupMessage,
  input: string,
  deps: ChickenDeps,
): Promise<ChickenResponse | null> {
  const command = parseChickenCommand(input);
  if (!command) return null;
  if (command.kind === "help") return { message: chickenGuide };
  if (command.kind === "invalid")
    return { message: lines("⚠️ Cú pháp chưa đúng.", "", chickenGuide) };

  if (command.kind === "create") {
    const name = cleanName(command.name ?? "Chiến Kê " + message.senderName);
    const created = repository.createChicken({
      zaloId: message.senderId,
      name,
      aggression: randomInt(12, 26),
      claws: randomInt(12, 26),
      comb: randomInt(12, 26),
      kickPower: randomInt(12, 26),
    });
    if (!created.created)
      return { message: "Bạn đã có gà " + created.chicken.name + ". Dùng /ga để xem hoặc /nangga để nâng cấp." };
    return {
      message: lines(
        "🐣 NHẬN GÀ THÀNH CÔNG",
        "",
        "Tên: " + created.chicken.name,
        "Level: 1",
        "Lực chiến: " + chickenPower(created.chicken).toLocaleString("vi-VN"),
        "",
        "Dùng @MbaLong /ga để xem ảnh và chỉ số.",
      ),
    };
  }

  const ownChicken = repository.chicken(message.senderId);
  if (!ownChicken)
    return { message: "Bạn chưa có gà chiến. Dùng @MbaLong /nuoiga [tên] để nhận gà đầu tiên." };

  if (command.kind === "view") {
    const image = await renderChickenImage(ownChicken, message.senderName);
    return {
      image,
      message: lines(
        "🐓 " + ownChicken.name + " · Level " + ownChicken.level,
        "Lực chiến: " + chickenPower(ownChicken).toLocaleString("vi-VN") + " · " + ownChicken.wins + " thắng / " + ownChicken.losses + " thua",
        "Nâng cấp kế: " + formatBetAmount(upgradeCost(ownChicken.level)),
      ),
    };
  }

  if (command.kind === "rename") {
    const renamed = repository.renameChicken(message.senderId, cleanName(command.name));
    return { message: "🏷️ Đã đổi tên gà thành " + renamed!.name + "." };
  }

  if (command.kind === "upgrade") {
    const cost = upgradeCost(ownChicken.level);
    const levelBoost = Math.min(50, ownChicken.level);
    const result = repository.upgradeChicken(message.senderId, cost, {
      aggression: randomInt(4, 10) + levelBoost,
      claws: randomInt(4, 10) + levelBoost,
      comb: randomInt(4, 10) + levelBoost,
      kickPower: randomInt(4, 10) + levelBoost,
    });
    if (!result.ok)
      return {
        message: result.reason === "insufficient"
          ? lines("Số dư không đủ để nâng gà.", "", "Cần: " + formatBetAmount(cost), "Hiện có: " + formatBetAmount(result.balance))
          : "Không tìm thấy gà chiến.",
      };
    repository.audit(message.senderId, "chicken.upgrade", message.senderId, {
      levelBefore: ownChicken.level,
      levelAfter: result.chicken.level,
      cost: cost.toString(),
      balanceAfter: result.balance.toString(),
    });
    return {
      message: lines(
        "⬆️ NÂNG GÀ THÀNH CÔNG",
        "",
        result.chicken.name + ": Level " + ownChicken.level + " → " + result.chicken.level,
        "Lực chiến mới: " + chickenPower(result.chicken).toLocaleString("vi-VN"),
        "Đã trừ: " + formatBetAmount(cost),
        "Số dư: " + formatBetAmount(result.balance),
        "Giá nâng kế: " + formatBetAmount(upgradeCost(result.chicken.level)),
      ),
    };
  }

  if (command.kind === "challenge") {
    const targets = targetMentions(message, deps.botIds);
    if (targets.length !== 1)
      return { message: "Hãy tag đúng một người muốn PK. Ví dụ: @MbaLong /pk @ĐốiThủ 1 tỷ" };
    const target = targets[0]!;
    if (target.canonicalId === message.senderId)
      return { message: "Không thể tự gạ kèo với chính mình." };
    const targetChicken = repository.chicken(target.canonicalId);
    if (!targetChicken)
      return { message: target.name + " chưa có gà chiến nên chưa thể nhận kèo." };
    const now = Date.now();
    const created = repository.createChickenChallenge({
      id: randomUUID(),
      groupId: message.groupId,
      challengerId: message.senderId,
      challengerName: message.senderName,
      targetId: target.canonicalId,
      targetName: target.name,
      stake: command.stake,
      now,
      expiresAt: now + CHALLENGE_TTL_MS,
    });
    if (!created.ok)
      return {
        message: created.reason === "insufficient"
          ? lines("Bạn không đủ tiền để gạ kèo.", "", "Tiền cược: " + formatBetAmount(command.stake), "Số dư: " + formatBetAmount(created.balance))
          : "Một trong hai người đang có kèo PK chờ xử lý. Hãy nhận, từ chối hoặc đợi kèo hết hạn.",
      };
    repository.audit(message.senderId, "chicken.challenge", target.canonicalId, {
      groupId: message.groupId,
      stake: command.stake.toString(),
      expiresAt: now + CHALLENGE_TTL_MS,
    });
    return {
      mention: { uid: target.rawUid, name: target.name },
      message: lines(
        "🥊 KÈO ĐÁ GÀ",
        "",
        message.senderName + " (" + ownChicken.name + " · LC " + chickenPower(ownChicken).toLocaleString("vi-VN") + ") gạ @" + target.name + " (" + targetChicken.name + " · LC " + chickenPower(targetChicken).toLocaleString("vi-VN") + ")",
        "",
        "Cược mỗi bên: " + formatBetAmount(command.stake),
        "Tổng pot: " + formatBetAmount(command.stake * 2n),
        "Kèo hết hạn sau 5 phút.",
        "",
        "@" + target.name + " hãy reply tin nhắn này bằng /y để nhận hoặc /tuchoi để từ chối.",
      ),
    };
  }

  if (!message.quoted || !deps.isReplyToBot(message))
    return { message: "Bạn phải reply đúng tin nhắn gạ kèo của MbaLong bằng /" + (command.kind === "accept" ? "y" : "tuchoi") + "." };
  const challenge = repository.pendingChickenChallenge(message.groupId, message.senderId);
  if (!challenge)
    return { message: "Không có kèo PK nào đang chờ bạn, hoặc kèo đã hết hạn." };

  if (command.kind === "decline") {
    const declined = repository.declineChickenChallenge(challenge.id, message.senderId);
    return { message: declined ? "🚫 " + message.senderName + " đã từ chối kèo đá gà." : "Kèo này không còn hiệu lực." };
  }

  const challengerChicken = repository.chicken(challenge.challenger_id);
  const targetChicken = repository.chicken(challenge.target_id);
  if (!challengerChicken || !targetChicken)
    return { message: "Một trong hai chiến kê không còn tồn tại." };
  let challengerScore = battleScore(challengerChicken, randomInt(85, 116));
  let targetScore = battleScore(targetChicken, randomInt(85, 116));
  if (challengerScore === targetScore) {
    if (randomInt(0, 2) === 0) challengerScore += 1;
    else targetScore += 1;
  }
  const winnerId = challengerScore > targetScore ? challenge.challenger_id : challenge.target_id;
  const settled = repository.settleChickenChallenge({
    id: challenge.id,
    targetId: message.senderId,
    winnerId,
    challengerScore,
    targetScore,
    now: Date.now(),
  });
  if (!settled.ok) {
    if (settled.reason === "challenger_insufficient")
      return { message: challenge.challenger_name + " không còn đủ " + formatBetAmount(BigInt(challenge.stake)) + " để vào kèo." };
    if (settled.reason === "target_insufficient")
      return { message: "Bạn không đủ " + formatBetAmount(BigInt(challenge.stake)) + " để vào kèo. Số dư hiện tại: " + formatBetAmount(settled.balance) + "." };
    if (settled.reason === "expired") return { message: "Kèo đã hết hạn." };
    return { message: "Kèo đã được xử lý hoặc không còn tồn tại." };
  }
  const winnerName = winnerId === challenge.challenger_id ? challenge.challenger_name : challenge.target_name;
  const loserName = winnerId === challenge.challenger_id ? challenge.target_name : challenge.challenger_name;
  const winnerChicken = winnerId === challenge.challenger_id ? challengerChicken : targetChicken;
  repository.audit(winnerId, "chicken.pk_settle", challenge.id, {
    groupId: message.groupId,
    loserId: winnerId === challenge.challenger_id ? challenge.target_id : challenge.challenger_id,
    stake: settled.stake.toString(),
    pot: (settled.stake * 2n).toString(),
    challengerScore,
    targetScore,
  });
  return {
    message: lines(
      "🏆 KẾT QUẢ ĐÁ GÀ",
      "",
      challenge.challenger_name + " · " + challengerChicken.name + ": " + challengerScore.toLocaleString("vi-VN") + " điểm",
      challenge.target_name + " · " + targetChicken.name + ": " + targetScore.toLocaleString("vi-VN") + " điểm",
      "",
      "👑 " + winnerChicken.name + " của " + winnerName + " chiến thắng!",
      loserName + " thua kèo.",
      "",
      "Tiền thưởng nhận về: " + formatBetAmount(settled.stake * 2n),
      "Lãi ròng người thắng: +" + formatBetAmount(settled.stake),
      "Số dư " + challenge.challenger_name + ": " + formatBetAmount(settled.challengerAfter),
      "Số dư " + challenge.target_name + ": " + formatBetAmount(settled.targetAfter),
    ),
  };
}

function cleanName(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30) || "Chiến Kê";
}

function targetMentions(message: IncomingGroupMessage, botIds: ReadonlySet<string>) {
  const seen = new Set<string>();
  const targets: Array<{ rawUid: string; canonicalId: string; name: string }> = [];
  for (const mention of message.mentions) {
    const rawUid = String(mention.uid ?? "").trim();
    if (!rawUid || rawUid === "-1") continue;
    const identities = repository.identityIds(message.groupId, [rawUid]);
    if ([...identities].some((id) => botIds.has(id))) continue;
    const canonicalId = repository.resolveMemberId(message.groupId, [rawUid]);
    if (!canonicalId || seen.has(canonicalId)) continue;
    seen.add(canonicalId);
    const member = repository.member(message.groupId, canonicalId);
    const start = Number.isInteger(mention.pos) ? mention.pos! : -1;
    const length = Number.isInteger(mention.len) ? mention.len! : 0;
    const fromText = start >= 0
      ? message.content.slice(start, start + length).replace(/^@/, "").trim()
      : "";
    targets.push({
      rawUid,
      canonicalId,
      name: member?.display_name ?? (fromText || "Zalo " + canonicalId),
    });
  }
  return targets;
}
