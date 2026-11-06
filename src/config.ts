import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
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
  SOUNDCLOUD_CLIENT_ID: z.string().default(""),
  SOUNDCLOUD_CLIENT_SECRET: z.string().default(""),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  DATABASE_PATH: z.string().default("./data/bot.db"),
  SESSION_PATH: z.string().default("./data/zalo-session.json"),
  PUBLIC_ORIGIN: z.string().default("http://localhost:8787"),
  BOT_NAME: z.string().min(1).max(30).default("MbaLong"),
});

const raw = schema.parse(process.env);
export const config = {
  ...raw,
  BOT_NAME: raw.BOT_NAME.toLowerCase() === "nova" ? "MbaLong" : raw.BOT_NAME,
  adminIds: new Set(
    raw.ZALO_ADMIN_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  ),
  allowedOrigins: new Set([raw.PUBLIC_ORIGIN, "http://localhost:5173"]),
};
