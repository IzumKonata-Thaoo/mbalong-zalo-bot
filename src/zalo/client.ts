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
      if (info) this.saveMembers(groupId, info);
      const parsed: IncomingGroupMessage = {
        groupId,
        senderId: String(data.uidFrom ?? data.senderId ?? ""),
        senderName: String(data.dName ?? data.displayName ?? "Thành viên"),
        content:
          typeof data.content === "string"
            ? data.content
            : (photo?.caption ?? ""),
        messageId: String(data.msgId ?? data.cliMsgId ?? ""),
        mentions: Array.isArray(data.mentions) ? data.mentions : [],
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
    for (let i = 0; i < chunks.length; i++)
      await this.api.sendMessage(
        {
          msg: chunks[i],
          ...(i === 0 && quote ? { quote: (quote as any).data } : {}),
        },
        groupId,
        ThreadType.Group,
      );
  }
  async sendVoiceFromStream(groupId: string, sourceUrl: string) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    return withM4aPreview(sourceUrl, async (path) => {
      const uploaded = await this.api.uploadAttachment(
        path,
        groupId,
        ThreadType.Group,
      );
      const voiceUrl = uploaded?.find?.(
        (item: any) => item?.fileType === "others" && item?.fileUrl,
      )?.fileUrl;
      if (!voiceUrl) throw new Error("Zalo không trả URL sau khi upload audio");
      return this.api.sendVoice({ voiceUrl }, groupId, ThreadType.Group);
    });
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
    this.saveMembers(groupId, info);
    return info;
  }
  private saveMembers(groupId: string, info: any) {
    const admins = new Set((info.adminIds ?? []).map(String));
    const profiles = new Map(
      (info.currentMems ?? []).map((m: any) => [String(m.id), m]),
    );
    const members = (info.memberIds ?? []).map((id: unknown) => {
      const key = String(id),
        m: any = profiles.get(key);
      return {
        id: key,
        name: m?.dName || m?.zaloName || `Zalo ${key}`,
        avatar: m?.avatar,
        role: admins.has(key) ? "admin" : "member",
      };
    });
    if (members.length) repository.upsertMembers(groupId, members);
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
export const zaloClient = new ZaloClient();
