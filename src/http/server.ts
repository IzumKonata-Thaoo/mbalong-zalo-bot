import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { config } from "../config.js";
import { repository } from "../db.js";
import { zaloClient } from "../zalo/client.js";
import {
  issueToken,
  passwordMatches,
  requireAdmin,
  sameOrigin,
  type AuthRequest,
} from "./auth.js";
import {
  isAllowedAIBaseUrl,
  publicAISettings,
  saveAISettings,
} from "../settings.js";
import { ai } from "../ai/provider.js";
import {
  getGameSettings,
  saveGameSettings,
} from "../games/game-settings.js";
import {
  CHICKEN_CLAW_ITEMS,
  chickenClawItem,
  publicChickenClawItem,
} from "../games/chicken-equipment.js";
import { renderChickenImage } from "../games/chicken-image.js";
import {
  chickenPinMatches,
  hashChickenPin,
  issueChickenToken,
  requireChickenSession,
  setChickenCookie,
  type ChickenAuthRequest,
} from "./chicken-auth.js";
import { formatBetAmount } from "../games/tai-xiu-rules.js";

const loginSchema = z.object({ password: z.string().min(1).max(256) });
const idSchema = z.object({ id: z.string().min(1).max(64).regex(/^\d+$/) });
const enabledSchema = z.object({ enabled: z.boolean() });
const aiSettingsSchema = z.object({
  baseUrl: z.string().url().max(2048),
  model: z.string().trim().min(1).max(200),
  format: z.enum(["openai", "anthropic", "gemini"]),
  systemPrompt: z.string().max(10000),
  apiKey: z.string().trim().max(10000).optional(),
  clearApiKey: z.boolean().optional(),
});
const gameSettingsSchema = z.object({
  taiXiuWinRate: z.number().int().min(0).max(100),
  marketWinRate: z.number().int().min(0).max(100),
  jackpotRate: z.number().int().min(0).max(100),
  jackpotAmount: z.string().regex(/^\d+$/).max(200),
  wipeoutRate: z.number().int().min(0).max(100),
});
const attempts = new Map<string, { count: number; reset: number }>();
const chickenAttempts = new Map<string, { count: number; reset: number }>();
const chickenPinSchema = z.object({ pin: z.string().regex(/^\d{4,12}$/) });
const chickenTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{24,64}$/) });
const chickenNameSchema = z.object({ name: z.string().trim().min(1).max(30) });

function chickenRateLimited(key: string) {
  const now = Date.now();
  const state = chickenAttempts.get(key) ?? { count: 0, reset: now + 15 * 60_000 };
  if (now > state.reset) {
    state.count = 0;
    state.reset = now + 15 * 60_000;
  }
  if (state.count >= 6) return true;
  state.count++;
  chickenAttempts.set(key, state);
  return false;
}

function chickenGaragePayload(zaloId: string) {
  const chicken = repository.chicken(zaloId);
  const profile = repository.chickenWebProfile(zaloId);
  if (!chicken || !profile) return null;
  const owned = new Set(repository.chickenOwnedItems(zaloId));
  const equipped = chickenClawItem(profile.equipped_item);
  return {
    chicken: {
      name: chicken.name,
      level: chicken.level,
      aggression: chicken.aggression,
      claws: chicken.claws,
      comb: chicken.comb,
      kickPower: chicken.kick_power,
      wins: chicken.wins,
      losses: chicken.losses,
    },
    balance: repository.walletBalance(zaloId).toString(),
    balanceLabel: formatBetAmount(repository.walletBalance(zaloId)),
    equippedItem: equipped.id,
    equippedName: equipped.name,
    items: CHICKEN_CLAW_ITEMS.map((item) => ({
      ...publicChickenClawItem(item),
      owned: owned.has(item.id),
      equipped: profile.equipped_item === item.id,
    })),
  };
}

export function createServer() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(sameOrigin);
  app.post("/api/auth/login", (req, res) => {
    const ip = req.ip ?? "unknown",
      now = Date.now(),
      state = attempts.get(ip) ?? { count: 0, reset: now + 900000 };
    if (now > state.reset) {
      state.count = 0;
      state.reset = now + 900000;
    }
    if (state.count >= 8)
      return res.status(429).json({ error: "Thử lại sau 15 phút" });
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success || !passwordMatches(parsed.data.password)) {
      state.count++;
      attempts.set(ip, state);
      return res.status(401).json({ error: "Mật khẩu không đúng" });
    }
    attempts.delete(ip);
    res
      .cookie("admin_session", issueToken(), {
        httpOnly: true,
        sameSite: "strict",
        secure: config.PUBLIC_ORIGIN.startsWith("https"),
        maxAge: 12 * 3600_000,
        path: "/",
      })
      .json({ ok: true });
  });
  app.post("/api/auth/logout", (_req, res) =>
    res.clearCookie("admin_session", { path: "/" }).json({ ok: true }),
  );
  app.get("/api/auth/me", requireAdmin, (_req, res) =>
    res.json({ authenticated: true }),
  );

  app.get("/api/chicken/:token/status", (req, res) => {
    const parsed = chickenTokenSchema.safeParse(req.params);
    if (!parsed.success) return res.status(404).json({ error: "Liên kết garage không hợp lệ" });
    const profile = repository.chickenWebProfileByToken(parsed.data.token);
    const chicken = profile ? repository.chicken(profile.zalo_id) : undefined;
    if (!profile || !chicken) return res.status(404).json({ error: "Liên kết garage không hợp lệ" });
    res.set("Cache-Control", "no-store").json({
      valid: true,
      pinConfigured: Boolean(profile.pin_hash),
      chickenName: chicken.name,
    });
  });
  app.post("/api/chicken/:token/setup", (req, res) => {
    const token = chickenTokenSchema.safeParse(req.params);
    const body = chickenPinSchema.safeParse(req.body);
    if (!token.success || !body.success)
      return res.status(400).json({ error: "PIN phải có từ 4 đến 12 chữ số" });
    const profile = repository.chickenWebProfileByToken(token.data.token);
    if (!profile) return res.status(404).json({ error: "Liên kết garage không hợp lệ" });
    const key = `${req.ip ?? "unknown"}:${token.data.token}`;
    if (chickenRateLimited(key)) return res.status(429).json({ error: "Thử lại sau 15 phút" });
    if (profile.pin_hash) return res.status(409).json({ error: "Garage này đã có PIN" });
    const secured = hashChickenPin(body.data.pin);
    if (!repository.setChickenPinIfUnset(profile.zalo_id, secured.salt, secured.hash))
      return res.status(409).json({ error: "Garage này vừa được đặt PIN" });
    chickenAttempts.delete(key);
    setChickenCookie(res, issueChickenToken(profile.zalo_id, profile.manage_token));
    repository.audit(profile.zalo_id, "chicken.web_pin_setup", profile.zalo_id);
    res.json({ ok: true });
  });
  app.post("/api/chicken/:token/login", (req, res) => {
    const token = chickenTokenSchema.safeParse(req.params);
    const body = chickenPinSchema.safeParse(req.body);
    if (!token.success || !body.success)
      return res.status(400).json({ error: "PIN phải có từ 4 đến 12 chữ số" });
    const profile = repository.chickenWebProfileByToken(token.data.token);
    if (!profile) return res.status(404).json({ error: "Liên kết garage không hợp lệ" });
    const key = `${req.ip ?? "unknown"}:${token.data.token}`;
    if (chickenRateLimited(key)) return res.status(429).json({ error: "Thử lại sau 15 phút" });
    if (!profile?.pin_hash || !profile.pin_salt || !chickenPinMatches(body.data.pin, profile.pin_salt, profile.pin_hash))
      return res.status(401).json({ error: "PIN không đúng" });
    chickenAttempts.delete(key);
    setChickenCookie(res, issueChickenToken(profile.zalo_id, profile.manage_token));
    res.json({ ok: true });
  });
  app.post("/api/chicken/:token/logout", (_req, res) =>
    res.clearCookie("chicken_session", { path: "/" }).json({ ok: true }),
  );
  app.get("/api/chicken/:token/garage", requireChickenSession, (req: ChickenAuthRequest, res) => {
    const payload = chickenGaragePayload(req.chickenAuth!.zaloId);
    if (!payload) return res.status(404).json({ error: "Không tìm thấy gà chiến" });
    res.set("Cache-Control", "no-store").json(payload);
  });
  app.get("/api/chicken/:token/image", requireChickenSession, async (req: ChickenAuthRequest, res, next) => {
    try {
      const chicken = repository.chicken(req.chickenAuth!.zaloId);
      const profile = repository.chickenWebProfile(req.chickenAuth!.zaloId);
      if (!chicken || !profile) return res.status(404).end();
      const preview = typeof req.query.preview === "string" ? req.query.preview : profile.equipped_item;
      const item = chickenClawItem(preview);
      const image = await renderChickenImage(chicken, "Tài khoản riêng", item);
      res.set({ "Content-Type": "image/png", "Cache-Control": "no-store" }).send(image);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/chicken/:token/name", requireChickenSession, (req: ChickenAuthRequest, res) => {
    const parsed = chickenNameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Tên gà phải có từ 1 đến 30 ký tự" });
    const name = parsed.data.name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    const renamed = repository.renameChicken(req.chickenAuth!.zaloId, name);
    if (!renamed) return res.status(404).json({ error: "Không tìm thấy gà chiến" });
    repository.audit(req.chickenAuth!.zaloId, "chicken.web_rename", req.chickenAuth!.zaloId, { name });
    res.json(chickenGaragePayload(req.chickenAuth!.zaloId));
  });
  app.post("/api/chicken/:token/equipment/:itemId", requireChickenSession, (req: ChickenAuthRequest, res) => {
    const item = CHICKEN_CLAW_ITEMS.find((candidate) => candidate.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: "Trang bị không tồn tại" });
    const result = repository.purchaseOrEquipChickenItem(req.chickenAuth!.zaloId, item.id, item.price);
    if (!result.ok) {
      if (result.reason === "insufficient")
        return res.status(409).json({ error: `Không đủ số dư. Hiện có ${formatBetAmount(result.balance)}` });
      return res.status(409).json({ error: "Garage chưa sẵn sàng" });
    }
    repository.audit(req.chickenAuth!.zaloId, result.purchased ? "chicken.item_purchase" : "chicken.item_equip", item.id, {
      price: result.purchased ? item.price.toString() : "0",
      balanceAfter: result.balance.toString(),
    });
    res.json(chickenGaragePayload(req.chickenAuth!.zaloId));
  });

  app.use("/api", requireAdmin);
  app.get("/api/dashboard", (_req, res) =>
    res.json({
      stats: repository.stats(),
      zalo: zaloClient.snapshot(),
      groups: repository.groups().slice(0, 6),
      audits: repository.audits(8),
    }),
  );
  app.delete("/api/context", (req: AuthRequest, res) => {
    const cleared = repository.clearAllContext();
    repository.audit(req.admin!.sub, "ai.context_clear_all", undefined, cleared);
    res.json({ ok: true, ...cleared });
  });
  app.get("/api/groups", (_req, res) => res.json(repository.groups()));
  app.post("/api/groups", async (req: AuthRequest, res, next) => {
    try {
      const group = idSchema.parse(req.body).id;
      await zaloClient.refreshGroup(group);
      repository.audit(req.admin!.sub, "group.add", group);
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.patch("/api/groups/:id", (req: AuthRequest, res) => {
    const p = idSchema.safeParse(req.params),
      b = enabledSchema.safeParse(req.body);
    if (!p.success || !b.success)
      return res.status(400).json({ error: "Dữ liệu không hợp lệ" });
    repository.setGroupEnabled(p.data.id, b.data.enabled);
    repository.audit(
      req.admin!.sub,
      b.data.enabled ? "group.enable" : "group.disable",
      p.data.id,
    );
    res.json({ ok: true });
  });
  app.post("/api/groups/:id/refresh", async (req, res, next) => {
    try {
      const p = idSchema.parse(req.params);
      const result = await zaloClient.refreshGroup(p.id);
      res.json({ ok: true, count: repository.members(p.id).length, ...result });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/groups/:id/members", (req, res) => {
    const p = idSchema.safeParse(req.params);
    if (!p.success) return res.status(400).json({ error: "ID không hợp lệ" });
    res.json(repository.members(p.data.id));
  });
  app.post("/api/groups/:id/members", async (req: AuthRequest, res, next) => {
    try {
      const group = idSchema.parse(req.params).id,
        member = idSchema.parse(req.body).id;
      await zaloClient.addMember(group, member);
      repository.audit(req.admin!.sub, "member.add", group, { zaloId: member });
      await zaloClient.refreshGroup(group);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.delete(
    "/api/groups/:id/members/:memberId",
    async (req: AuthRequest, res, next) => {
      try {
        const group = idSchema.parse({ id: req.params.id }).id,
          member = idSchema.parse({ id: req.params.memberId }).id;
        const record = repository.member(group, member);
        if (
          config.adminIds.has(member) ||
          member === zaloClient.ownId ||
          record?.role === "admin"
        )
          return res.status(400).json({
            error:
              "Không thể xóa admin nhóm, admin hệ thống hoặc tài khoản bot",
          });
        await zaloClient.removeMember(group, member);
        repository.audit(req.admin!.sub, "member.remove", group, {
          zaloId: member,
        });
        await zaloClient.refreshGroup(group);
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );
  app.get("/api/audit", (_req, res) => res.json(repository.audits(100)));
  app.get("/api/config", (_req, res) =>
    res.json({
      botName: config.BOT_NAME,
      ai: publicAISettings(),
      searchEnabled: Boolean(config.SEARCH_API_KEY),
      music: {
        soundCloud: true,
        provider: "yt-dlp",
      },
      games: getGameSettings(),
      adminIds: [...config.adminIds],
      sessionPath: config.SESSION_PATH,
    }),
  );
  app.put("/api/config/ai", (req: AuthRequest, res) => {
    const parsed = aiSettingsSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Cấu hình AI không hợp lệ" });
    if (!isAllowedAIBaseUrl(parsed.data.baseUrl))
      return res.status(400).json({
        error:
          "Base URL phải dùng HTTPS; HTTP chỉ được phép với localhost, IP LAN riêng hoặc IP Tailscale",
      });
    const saved = saveAISettings(parsed.data);
    repository.audit(req.admin!.sub, "config.ai.update", "ai-provider", {
      baseUrl: saved.baseUrl,
      model: saved.model,
      format: saved.format,
      systemPromptChanged: true,
      apiKeyChanged: Boolean(parsed.data.apiKey),
      apiKeyCleared: Boolean(parsed.data.clearApiKey),
    });
    res.json(saved);
  });
  app.put("/api/config/games", (req: AuthRequest, res) => {
    const parsed = gameSettingsSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error:
          "Tỉ lệ phải là số nguyên từ 0 đến 100 và tiền nổ hũ phải là số nguyên không âm",
      });
    const saved = saveGameSettings(parsed.data);
    repository.audit(req.admin!.sub, "config.games.update", "game-win-rates", saved);
    res.json(saved);
  });
  app.post("/api/config/ai/test", async (_req, res, next) => {
    try {
      const started = Date.now(),
        result = await ai.test();
      res.json({
        ok: true,
        latencyMs: Date.now() - started,
        response: result.slice(0, 80),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/zalo/relogin", async (_req, res) => {
    zaloClient.disconnect();
    void zaloClient.connect(true);
    res.json({ ok: true });
  });
  const web = resolve("dist/web");
  if (existsSync(web)) {
    app.use(express.static(web));
    app.use((req, res, next) =>
      req.method === "GET" && !req.path.startsWith("/api/")
        ? res.sendFile(resolve(web, "index.html"))
        : next(),
    );
  }
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Lỗi máy chủ",
      });
    },
  );
  return app;
}
