import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import qrcode from "qrcode-terminal";
import { LoginQRCallbackEventType, ThreadType, Zalo } from "zca-js";
import { config } from "../config.js";
import { repository } from "../db.js";
import type { BotStatus, IncomingGroupMessage } from "../types.js";
import { hasExactMention, stripExactMention } from "./policy.js";
import { extractZaloPhoto } from "./media.js";
import { withM4aPreview } from "../music/audio.js";
import { buildGroupVoicePayload } from "./voice.js";
import { normalizeZaloQuote } from "./quote.js";
import {
  extractGroupMemberIds,
  fetchGroupMemberProfiles,
  fetchLinkedGroupMembers,
  normalizeGroupMembers,
} from "./members.js";

type ZaloApi = any;

class ZaloClient extends EventEmitter {
  private api: ZaloApi | null = null;
  status: BotStatus = "offline";
  ownId = "";
  accountName = "";
  lastError = "";

  snapshot() {
    return {
      status: this.status,
      ownId: this.ownId,
      accountName: this.accountName,
      lastError: this.lastError,
    };
  }
  private setStatus(status: BotStatus, error = "") {
    this.status = status;
    this.lastError = error;
    this.emit("status", this.snapshot());
  }

  async connect(forceQr = false) {
    if (this.status === "connecting" || this.status === "qr") return;
    this.setStatus("connecting");
    const zalo = new Zalo({ logging: true, selfListen: false });
    let api: ZaloApi;
    try {
      if (!forceQr && existsSync(config.SESSION_PATH)) {
        try {
          api = await zalo.login(
            JSON.parse(await readFile(config.SESSION_PATH, "utf8")),
          );
        } catch {
          api = await this.loginQr(zalo);
        }
      } else api = await this.loginQr(zalo);
      this.api = api;
      this.installKnownSizeVoiceSender(api);
      this.ownId = String(api.getOwnId());
      const own = await api.fetchAccountInfo().catch(() => null);
      this.accountName =
        own?.profile?.displayName ?? own?.profile?.zaloName ?? config.BOT_NAME;
      this.bindListener();
      this.setStatus("online");
      console.log(`\n✓ Zalo online: ${this.accountName} (${this.ownId})`);
      console.log(
        "  Dùng ID ở trên cho ZALO_ADMIN_IDS nếu tài khoản bot cũng là admin.\n",
      );
    } catch (error) {
      this.setStatus(
        "error",
        error instanceof Error ? error.message : String(error),
      );
      console.error("Zalo login failed:", error);
    }
  }

  private async loginQr(zalo: Zalo): Promise<ZaloApi> {
    this.setStatus("qr");
    mkdirSync(dirname(config.SESSION_PATH), { recursive: true });
    const qrPath = join(dirname(config.SESSION_PATH), "qr.png");
    return zalo.loginQR({ qrPath }, async (event: any) => {
      if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
        console.log(
          "\n╭─────────────────────────────────────╮\n│  Quét QR bằng ứng dụng Zalo          │\n╰─────────────────────────────────────╯\n",
        );
        qrcode.generate(event.data.code, { small: true });
        await event.actions.saveToFile(qrPath);
      } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
        console.log("QR hết hạn, đang tạo mã mới…");
        event.actions.retry();
      } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
        console.log(
          `Đã quét bởi ${event.data.display_name}. Xác nhận trên điện thoại…`,
        );
      } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
        await writeFile(
          config.SESSION_PATH,
          JSON.stringify(event.data, null, 2),
          { encoding: "utf8", mode: 0o600 },
        );
      }
    }) as Promise<ZaloApi>;
  }

  private bindListener() {
    if (!this.api) return;
    this.api.listener.on("message", async (message: any) => {
      if (message.isSelf || message.type !== ThreadType.Group) return;
      const data = message.data;
      const directPhoto =
        data?.msgType === "chat.photo" ? extractZaloPhoto(data.content) : null;
      const quotedPhoto = data?.quote?.attach
        ? extractZaloPhoto(data.quote.attach)
        : null;
      const photo = directPhoto?.url
        ? directPhoto
        : quotedPhoto?.url
          ? quotedPhoto
          : null;
      if (typeof data?.content !== "string" && !photo?.url) return;
      const groupId = String(message.threadId);
      const known = repository.group(groupId);
      const info = known
        ? null
        : await this.groupInfo(groupId).catch(() => null);
      repository.upsertGroup(
        groupId,
        info?.name ?? known?.name ?? `Nhóm ${groupId}`,
        info?.totalMember ?? known?.member_count ?? 0,
      );
      if (info)
        await this.saveMembers(groupId, info).catch((error) => {
          this.lastError = `Không đồng bộ được thành viên nhóm ${groupId}: ${String(error)}`;
          console.warn(this.lastError);
        });
      const senderCandidates = [
        data.uidFrom,
        data.userId,
        data.uin,
        data.senderId,
      ].map((value) => String(value ?? "").trim()).filter(Boolean);
      let senderId = repository.resolveMemberId(groupId, senderCandidates);
      if (senderId && !repository.member(groupId, senderId)) {
        const memberInfo = info ?? await this.groupInfo(groupId).catch(() => null);
        if (memberInfo)
          await this.saveObservedMember(groupId, memberInfo, senderCandidates)
            .catch(() => undefined);
        senderId = repository.resolveMemberId(groupId, senderCandidates);
      }
      const mentions = Array.isArray(data.mentions)
        ? data.mentions.map((mention: any) => ({
            ...mention,
            uid: repository.resolveMemberId(groupId, [mention?.uid]),
          }))
        : [];
      const parsed: IncomingGroupMessage = {
        groupId,
        senderId,
        senderName: String(data.dName ?? data.displayName ?? "Thành viên"),
        content:
          typeof data.content === "string"
            ? data.content
            : (photo?.caption ?? ""),
        messageId: String(data.msgId ?? data.cliMsgId ?? ""),
        mentions,
        quoted: data?.quote,
        imageUrl: photo?.url,
        raw: message,
      };
      this.emit("group-message", parsed);
    });
    this.api.listener.on("error", (error: unknown) => {
      this.lastError = String(error);
      this.emit("status", this.snapshot());
    });
    this.api.listener.start({ retryOnClose: true });
  }

  isMentioned(message: IncomingGroupMessage) {
    return hasExactMention(message.mentions, this.ownId);
  }
  stripOwnMention(message: IncomingGroupMessage) {
    return stripExactMention(message.content, message.mentions, this.ownId);
  }
  async send(groupId: string, text: string, quote?: unknown) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    const chunks = splitMessage(text, 1800);
    const normalizedQuote = normalizeZaloQuote(quote);
    for (let i = 0; i < chunks.length; i++)
      await this.api.sendMessage(
        {
          msg: chunks[i],
          ...(i === 0 && normalizedQuote ? { quote: normalizedQuote } : {}),
        },
        groupId,
        ThreadType.Group,
      );
  }
  async sendVoiceFromStream(groupId: string, sourceUrl: string) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    return withM4aPreview(sourceUrl, async (path) => {
      const uploaded = await withTimeout<any[]>(
        this.api.uploadAttachment(path, groupId, ThreadType.Group),
        30_000,
        "Upload audio lên Zalo quá thời gian",
      );
      const voice = uploaded?.find?.(
        (item: any) => item?.fileType === "others" && item?.fileUrl,
      );
      if (!voice?.fileUrl)
        throw new Error("Zalo không trả URL sau khi upload audio");
      const voiceUrl = new URL(String(voice.fileUrl));
      if (
        voiceUrl.protocol !== "https:" ||
        voiceUrl.username ||
        voiceUrl.password
      )
        throw new Error("URL audio Zalo sau upload không hợp lệ");
      const fileSize = Number(voice.totalSize);
      if (!Number.isSafeInteger(fileSize) || fileSize <= 0)
        throw new Error("Zalo không trả dung lượng audio hợp lệ");
      const sent = await withTimeout<{ msgId?: string }>(
        this.api.sendVoiceKnownSize({
          voiceUrl: voiceUrl.toString(),
          fileSize,
          groupId,
        }),
        15_000,
        "Gửi tin nhắn ghi âm Zalo quá thời gian",
      );
      if (!sent?.msgId)
        throw new Error("Zalo không xác nhận msgId của tin nhắn ghi âm");
      console.log(`✓ Đã gửi voice Zalo ${sent.msgId} (${fileSize} bytes)`);
      return sent;
    });
  }
  private installKnownSizeVoiceSender(api: ZaloApi) {
    api.custom(
      "sendVoiceKnownSize",
      async ({ ctx, utils, props }: any) => {
        const serviceUrl = utils.makeURL(
          `${api.zpwServiceMap.file[0]}/api/group/forward`,
        );
        const params = buildGroupVoicePayload({
          groupId: props.groupId,
          voiceUrl: props.voiceUrl,
          fileSize: props.fileSize,
          imei: ctx.imei,
        });
        const encrypted = utils.encodeAES(JSON.stringify(params));
        if (!encrypted) throw new Error("Không mã hóa được payload voice Zalo");
        const response = await utils.request(serviceUrl, {
          method: "POST",
          body: new URLSearchParams({ params: encrypted }),
        });
        return utils.resolve(response);
      },
    );
  }
  async groupInfo(groupId: string) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    const result = await this.api.getGroupInfo(groupId);
    return result.gridInfoMap?.[groupId];
  }
  async refreshGroup(groupId: string) {
    const info = await this.groupInfo(groupId);
    if (!info) throw new Error("Không tìm thấy nhóm");
    repository.upsertGroup(groupId, info.name, info.totalMember);
    return this.saveMembers(groupId, info);
  }
  private async saveMembers(groupId: string, info: any) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    const total = Number(info?.totalMember ?? 0);
    let workingInfo = info;
    if (extractGroupMemberIds(info).length < total) {
      const linkedMembers = await fetchLinkedGroupMembers(groupId, this.api)
        .catch(() => []);
      if (linkedMembers.length) {
        workingInfo = {
          ...info,
          currentMems: [
            ...(Array.isArray(info?.currentMems) ? info.currentMems : []),
            ...linkedMembers,
          ],
        };
      }
    }
    const uniqueIds = extractGroupMemberIds(workingInfo);
    const profiles = await fetchGroupMemberProfiles(
      uniqueIds,
      (batch) => this.api!.getGroupMembersInfo(batch),
    );
    const normalized = normalizeGroupMembers(workingInfo, profiles);
    if (!normalized.members.length && uniqueIds.length)
      throw new Error("Zalo không trả về hồ sơ thành viên của nhóm");
    const partial = total > normalized.members.length;
    if (normalized.members.length) {
      if (partial) {
        repository.upsertMembers(groupId, normalized.members);
        repository.upsertMemberAliases(groupId, normalized.aliases);
      } else {
        repository.replaceMembers(
          groupId,
          normalized.members,
          normalized.aliases,
        );
      }
    }
    return { synced: normalized.members.length, total, partial };
  }
  private async saveObservedMember(
    groupId: string,
    groupInfo: any,
    candidateIds: string[],
  ) {
    if (!this.api) return;
    const ids = [...new Set(candidateIds.filter(Boolean))];
    if (!ids.length) return;
    const profiles = await fetchGroupMemberProfiles(
      ids,
      (batch) => this.api!.getGroupMembersInfo(batch),
    );
    const normalized = normalizeGroupMembers(
      {
        ...groupInfo,
        memberIds: ids,
        memVerList: [],
        currentMems: [],
      },
      profiles,
    );
    if (!normalized.members.length) return;
    repository.upsertMembers(groupId, normalized.members);
    repository.upsertMemberAliases(groupId, normalized.aliases);
  }
  async addMember(groupId: string, zaloId: string) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    return this.api.addUserToGroup(zaloId, groupId);
  }
  async removeMember(groupId: string, zaloId: string) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    return this.api.removeUserFromGroup(zaloId, groupId);
  }
  disconnect() {
    try {
      this.api?.listener.stop();
    } finally {
      this.api = null;
      this.setStatus("offline");
    }
  }
}

function splitMessage(text: string, max: number) {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.55) cut = rest.lastIndexOf(" ", max);
    if (cut < 1) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
export const zaloClient = new ZaloClient();
