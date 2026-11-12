import "dotenv/config";
import { z } from "zod";

function isTailscaleIpv4(value: string) {
  const parts = value.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    parts[0] === 100 &&
    parts[1]! >= 64 &&
    parts[1]! <= 127
  );
}

const optionalTailscaleIp = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z
    .string()
    .refine(isTailscaleIpv4, "TAILSCALE_LISTEN_IP phải thuộc dải 100.64.0.0/10")
    .optional(),
);

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),
  TAILSCALE_LISTEN_IP: optionalTailscaleIp,
  ADMIN_PASSWORD: z
    .string()
    .min(12)
    .refine(
      (value) => value !== "change-this-strong-password",
      "ADMIN_PASSWORD vẫn là giá trị mẫu",
    ),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine(
      (value) => value !== "replace-with-at-least-32-random-characters",
      "JWT_SECRET vẫn là giá trị mẫu",
    ),
  ZALO_ADMIN_IDS: z.string().default(""),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gpt-4.1-mini"),
  SEARCH_API_URL: z.string().url().default("https://api.tavily.com/search"),
  SEARCH_API_KEY: z.string().default(""),
  YTDLP_PATH: z.string().default("yt-dlp"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  DATABASE_PATH: z.string().default("./data/bot.db"),
  SESSION_PATH: z.string().default("./data/zalo-session.json"),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:8787"),
  BOT_NAME: z.string().min(1).max(30).default("MbaLong"),
});

const raw = schema.parse(process.env);
const tailscaleOrigin = raw.TAILSCALE_LISTEN_IP
  ? `http://${raw.TAILSCALE_LISTEN_IP}:${raw.PORT}`
  : undefined;
const listenerHosts =
  raw.HOST === "0.0.0.0" || raw.HOST === "::"
    ? [raw.HOST]
    : [...new Set([raw.HOST, raw.TAILSCALE_LISTEN_IP].filter(Boolean) as string[])];
export const config = {
  ...raw,
  BOT_NAME: raw.BOT_NAME.toLowerCase() === "nova" ? "MbaLong" : raw.BOT_NAME,
  adminIds: new Set(
    raw.ZALO_ADMIN_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  ),
  tailscaleOrigin,
  listenerHosts,
  allowedOrigins: new Set(
    [
      raw.PUBLIC_ORIGIN,
      `http://localhost:${raw.PORT}`,
      `http://127.0.0.1:${raw.PORT}`,
      "http://localhost:5173",
      tailscaleOrigin,
    ].filter(Boolean) as string[],
  ),
};
