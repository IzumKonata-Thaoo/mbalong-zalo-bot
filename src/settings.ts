import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { config } from "./config.js";
import { repository } from "./db.js";
import type { AIFormat } from "./ai/formats.js";

export interface AISettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  format: AIFormat;
  systemPrompt: string;
}
const KEY = createHash("sha256").update(config.JWT_SECRET).digest();

function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
function decrypt(value: string) {
  const [version, iv, tag, payload] = value.split(".");
  if (version !== "v1" || !iv || !tag || !payload)
    throw new Error("Định dạng API key không hợp lệ");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    KEY,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function getAISettings(): AISettings {
  const storedKey = repository.setting("ai.api_key");
  const storedFormat = repository.setting("ai.format");
  let apiKey = config.AI_API_KEY;
  if (storedKey) {
    try {
      apiKey = decrypt(storedKey);
    } catch {
      throw new Error(
        "Không giải mã được API key. Hãy nhập lại trong web admin.",
      );
    }
  }
  return {
    baseUrl: repository.setting("ai.base_url") ?? config.AI_BASE_URL,
    model: repository.setting("ai.model") ?? config.AI_MODEL,
    apiKey,
    format: (storedFormat === "deepseek"
      ? "openai"
      : (storedFormat ?? "openai")) as AIFormat,
    systemPrompt: repository.setting("ai.system_prompt") ?? "",
  };
}

export function publicAISettings() {
  try {
    const current = getAISettings();
    return {
      baseUrl: current.baseUrl,
      model: current.model,
      format: current.format,
      systemPrompt: current.systemPrompt,
      hasApiKey: Boolean(current.apiKey),
      apiKeyHint: current.apiKey ? `••••${current.apiKey.slice(-4)}` : "",
      keyError: false,
    };
  } catch {
    const storedFormat = repository.setting("ai.format");
    return {
      baseUrl: repository.setting("ai.base_url") ?? config.AI_BASE_URL,
      model: repository.setting("ai.model") ?? config.AI_MODEL,
      format: (storedFormat === "deepseek"
        ? "openai"
        : (storedFormat ?? "openai")) as AIFormat,
      systemPrompt: repository.setting("ai.system_prompt") ?? "",
      hasApiKey: false,
      apiKeyHint: "",
      keyError: true,
    };
  }
}

export function saveAISettings(input: {
  baseUrl: string;
  model: string;
  format: AIFormat;
  systemPrompt: string;
  apiKey?: string;
  clearApiKey?: boolean;
}) {
  const values: Record<string, string> = {
    "ai.base_url": input.baseUrl.replace(/\/$/, ""),
    "ai.model": input.model,
    "ai.format": input.format,
    "ai.system_prompt": input.systemPrompt,
  };
  if (input.apiKey) values["ai.api_key"] = encrypt(input.apiKey);
  repository.setSettings(values);
  if (input.clearApiKey) repository.deleteSetting("ai.api_key");
  return publicAISettings();
}

export function isAllowedAIBaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname))
      return true;
    const parts = url.hostname.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return false;
    const [a, b] = parts as [number, number, number, number];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  } catch {
    return false;
  }
}
