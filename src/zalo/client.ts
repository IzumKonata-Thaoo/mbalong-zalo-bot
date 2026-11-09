import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import qrcode from "qrcode-terminal";
import { LoginQRCallbackEventType, ThreadType, Zalo } from "zca-js";
import { config } from "../config.js";
import { repository } from "../db.js";
import type { BotStatus, IncomingGroupMessage } from "../types.js";
import { findIdentityMentionUid, stripExactMention } from "./policy.js";
import { extractZaloPhoto } from "./media.js";
import { withM4aPreview } from "../music/audio.js";
import { buildGroupVoicePayload } from "./voice.js";
import { normalizeZaloQuote } from "./quote.js";
import {
  describeGroupInfo,
  emptyLinkedSnapshot,
  extractGroupAdminIds,
  extractGroupMemberIds,
  fetchGroupMemberProfiles,
  fetchLinkedGroupSnapshot,
  isNumericZaloId,
  normalizeGroupMembers,
  usableId,
  type LinkedGroupSnapshot,
} from "./members.js";
import { hasWalletAdminPermission } from "../games/wallet-auth.js";

export interface MemberSyncReport {
  synced: number;
  total: number;
  partial: boolean;
  sources: {
    groupInfo: number;
    link: number;
    linkEnabled: boolean;
    linkPages: number;
    history: number;
  };
  warnings: string[];
}

const ADMIN_CACHE_MS = 20_000;

type ZaloApi = any;

class ZaloClient extends EventEmitter {
  private api: ZaloApi | null = null;
  status: BotStatus = "offline";
  ownId = "";
  accountName = "";
  lastError = "";
  private adminCache = new Map<string, { at: number; ids: Set<string> }>();

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
      void this.refreshEnabledGroups();
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
      const mentions = Array.isArray(data.mentions) ? data.mentions : [];
      const parsed: IncomingGroupMessage = {
        groupId,
        senderId,
        senderIds: senderCandidates,
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
    return Boolean(this.ownMentionUid(message));
  }
  stripOwnMention(message: IncomingGroupMessage) {
    return stripExactMention(
      message.content,
      message.mentions,
      this.ownMentionUid(message),
    );
  }
  private ownMentionUid(message: IncomingGroupMessage) {
    return findIdentityMentionUid(
      message.mentions,
      this.ownId,
      (id) => repository.resolveMemberId(message.groupId, [id]),
    );
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
  async sendImage(
    groupId: string,
    image: Buffer,
    caption: string,
    quote?: unknown,
  ) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    const normalizedQuote = normalizeZaloQuote(quote);
    return this.api.sendMessage(
      {
        msg: caption,
        attachments: {
          data: image,
          filename: `mbalong-market-${Date.now()}.png`,
          metadata: {
            totalSize: image.length,
            width: 1280,
            height: 720,
          },
        },
        ...(normalizedQuote ? { quote: normalizedQuote } : {}),
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
  /** All IDs that belong to the bot account itself. */
  botIds(groupId?: string) {
    const ids = new Set<string>([this.ownId].filter(Boolean));
    if (groupId && this.ownId)
      for (const id of repository.identityIds(groupId, [this.ownId])) ids.add(id);
    return ids;
  }
  private async linkedSnapshot(groupId: string, allPages: boolean) {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    try {
      return await fetchLinkedGroupSnapshot(groupId, this.api, allPages);
    } catch (error) {
      return emptyLinkedSnapshot(errorMessage(error));
    }
  }
  /**
   * Owner + deputy IDs straight from Zalo (getGroupInfo and the join-link
   * endpoint). Cached briefly so a burst of /nap commands stays cheap.
   */
  async groupAdminIds(groupId: string, force = false): Promise<Set<string>> {
    const cached = this.adminCache.get(groupId);
    if (!force && cached && Date.now() - cached.at < ADMIN_CACHE_MS)
      return cached.ids;
    const ids = new Set<string>();
    const info = await this.groupInfo(groupId).catch((error) => {
      console.warn(`[admin] getGroupInfo ${groupId} lỗi: ${errorMessage(error)}`);
      return null;
    });
    for (const id of extractGroupAdminIds(info)) ids.add(id);
    const linked = await this.linkedSnapshot(groupId, false);
    for (const id of extractGroupAdminIds(linked)) ids.add(id);
    if (!ids.size)
      console.warn(
        `[admin] Không đọc được trưởng/phó nhóm ${groupId} từ Zalo` +
          (linked.error ? ` (link: ${linked.error})` : ""),
      );
    this.adminCache.set(groupId, { at: Date.now(), ids });
    return ids;
  }
  /**
   * Live permission check for special commands: ZALO_ADMIN_IDS, the group
   * owner or any deputy. Does not depend on the member list being complete.
   */
  async isGroupAdmin(message: IncomingGroupMessage): Promise<boolean> {
    // Only the IDs on the message itself plus member-unique aliases: profile
    // globalIds can be shared by many members and must not grant admin.
    const identity = repository.identityIds(message.groupId, [
      message.senderId,
      ...message.senderIds,
    ]);
    if (hasWalletAdminPermission(identity, config.adminIds)) return true;
    let admins = await this.groupAdminIds(message.groupId);
    if (!hasWalletAdminPermission(identity, config.adminIds, admins))
      admins = await this.groupAdminIds(message.groupId, true);
    const allowed = hasWalletAdminPermission(identity, config.adminIds, admins);
    const stored = repository.member(message.groupId, message.senderId);
    if (stored && (stored.role === "admin") !== allowed && admins.size)
      repository.setMemberRole(
        message.groupId,
        message.senderId,
        allowed ? "admin" : "member",
      );
    if (!allowed)
      console.warn(
        `[admin] Từ chối ${message.senderName}: ID [${[...identity].join(", ")}] ` +
          `không thuộc trưởng/phó nhóm [${[...admins].join(", ")}] hoặc ZALO_ADMIN_IDS`,
      );
    return allowed;
  }
  /** Canonical member ID for a typed Zalo ID, or "" when it is not in the group. */
  async findGroupMember(groupId: string, zaloId: string): Promise<string> {
    const known = () => {
      const id = repository.resolveMemberId(groupId, [zaloId]);
      return repository.member(groupId, id) ? id : "";
    };
    const direct = known();
    if (direct) return direct;
    const info = await this.groupInfo(groupId).catch(() => null);
    if (info && extractGroupMemberIds(info).includes(zaloId)) {
      await this.saveObservedMember(groupId, info, [zaloId]).catch(() => undefined);
      return known() || zaloId;
    }
    await this.refreshGroup(groupId).catch(() => undefined);
    return known();
  }
  async refreshGroup(groupId: string): Promise<MemberSyncReport> {
    const info = await this.groupInfo(groupId);
    if (!info) throw new Error("Không tìm thấy nhóm");
    repository.upsertGroup(groupId, info.name, info.totalMember);
    return this.saveMembers(groupId, info);
  }
  private async refreshEnabledGroups() {
    for (const group of repository.groups().filter((item) => item.enabled)) {
      if (!this.api) return;
      await this.refreshGroup(group.id).catch((error) =>
        console.warn(`[members] Không làm mới được nhóm ${group.id}: ${errorMessage(error)}`),
      );
    }
  }
  private async historySenderIds(groupId: string): Promise<string[]> {
    if (typeof this.api?.getGroupChatHistory !== "function") return [];
    const history = await this.api.getGroupChatHistory(groupId, 50);
    const ids = new Set<string>();
    for (const message of history?.groupMsgs ?? []) {
      const id = usableId(message?.data?.uidFrom);
      if (id) ids.add(id);
    }
    return [...ids];
  }
  private async saveMembers(groupId: string, info: any): Promise<MemberSyncReport> {
    if (!this.api) throw new Error("Zalo chưa kết nối");
    const warnings: string[] = [];
    const infoIds = extractGroupMemberIds(info);
    let total = Number(info?.totalMember ?? 0);

    const linked: LinkedGroupSnapshot = await this.linkedSnapshot(
      groupId,
      infoIds.length < total,
    );
    if (linked.error) warnings.push(`Link nhóm: ${linked.error}`);
    else if (!linked.linkEnabled && infoIds.length < total)
      warnings.push("Link tham gia nhóm đang tắt hoặc Zalo không trả link.");
    total = Math.max(total, linked.totalMember);

    let historyIds: string[] = [];
    const known = new Set([...infoIds, ...extractGroupMemberIds(linked)]);
    if (known.size < total)
      historyIds = await this.historySenderIds(groupId).catch((error) => {
        warnings.push(`Lịch sử chat: ${errorMessage(error)}`);
        return [] as string[];
      });

    const workingInfo = {
      ...info,
      creatorId: info?.creatorId || linked.creatorId,
      adminIds: [
        ...(Array.isArray(info?.adminIds) ? info.adminIds : []),
        linked.creatorId,
        ...linked.adminIds,
      ].filter(Boolean),
      admins: [
        ...(Array.isArray(info?.admins) ? info.admins : []),
        ...linked.admins,
      ],
      memberIds: [
        ...(Array.isArray(info?.memberIds) ? info.memberIds : []),
        ...historyIds,
      ],
      currentMems: [
        ...(Array.isArray(info?.currentMems) ? info.currentMems : []),
        ...linked.members,
      ],
    };
    const uniqueIds = extractGroupMemberIds(workingInfo);
    const profiles = await fetchGroupMemberProfiles(
      uniqueIds.filter(isNumericZaloId),
      (batch) => this.api!.getGroupMembersInfo(batch),
    ).catch((error) => {
      warnings.push(`Hồ sơ thành viên: ${errorMessage(error)}`);
      return [] as any[];
    });
    const normalized = normalizeGroupMembers(workingInfo, profiles);
    if (normalized.ambiguousIds.length)
      warnings.push(
        `Bỏ qua ${normalized.ambiguousIds.length} ID hồ sơ dùng chung cho nhiều thành viên (${normalized.ambiguousIds.slice(0, 3).join(", ")})`,
      );
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
    const adminMemberIds = new Set(
      normalized.members.filter((m) => m.role === "admin").map((m) => m.id),
    );
    this.adminCache.set(groupId, {
      at: Date.now(),
      ids: new Set([
        ...extractGroupAdminIds(workingInfo),
        ...normalized.aliases
          .filter((alias) => adminMemberIds.has(alias.zaloId))
          .map((alias) => alias.aliasId),
      ]),
    });
    const report: MemberSyncReport = {
      synced: normalized.members.length,
      total,
      partial,
      sources: {
        groupInfo: infoIds.length,
        link: linked.members.length,
        linkEnabled: linked.linkEnabled,
        linkPages: linked.pages,
        history: historyIds.length,
      },
      warnings,
    };
    const line =
      `[members] ${groupId}: ${report.synced}/${total} | getGroupInfo(${describeGroupInfo(info)}) ` +
      `| link(enabled=${linked.linkEnabled} pages=${linked.pages} members=${linked.members.length} ` +
      `admins=${linked.adminIds.length} total=${linked.totalMember}) | history=${historyIds.length}` +
      (warnings.length ? ` | ${warnings.join("; ")}` : "");
    if (partial) console.warn(line);
    else console.log(line);
    return report;
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
      ids.filter(isNumericZaloId),
      (batch) => this.api!.getGroupMembersInfo(batch),
    );
    const normalized = normalizeGroupMembers({ memberIds: ids }, profiles);
    if (!normalized.members.length) return;
    const adminIds = new Set(extractGroupAdminIds(groupInfo));
    for (const member of normalized.members)
      if (
        normalized.aliases.some(
          (alias) => alias.zaloId === member.id && adminIds.has(alias.aliasId),
        )
      )
        member.role = "admin";
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

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return code === undefined ? error.message : `${error.message} (code ${String(code)})`;
  }
  return String(error);
}
