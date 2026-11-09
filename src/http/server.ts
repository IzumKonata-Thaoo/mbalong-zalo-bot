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
});
const attempts = new Map<string, { count: number; reset: number }>();

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
        error: "Tỉ lệ thắng phải là số nguyên từ 0 đến 100",
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
