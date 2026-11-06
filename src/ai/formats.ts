import type { ChatMessage } from "../types.js";

export type AIFormat = "openai" | "anthropic" | "gemini";
export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const trim = (value: string) => value.replace(/\/$/, "");
const isDeepSeekBase = (value: string) => {
  try {
    return new URL(value).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
};
const systemText = (messages: ChatMessage[]) =>
  messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
const anthropicContent = (message: ChatMessage) =>
  message.images?.length
    ? [
        { type: "text", text: message.content },
        ...message.images.map((image) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mimeType,
            data: image.data,
          },
        })),
      ]
    : message.content;
const geminiParts = (message: ChatMessage) => [
  { text: message.content },
  ...(message.images ?? []).map((image) => ({
    inlineData: { mimeType: image.mimeType, data: image.data },
  })),
];
const openAIContent = (message: ChatMessage) =>
  message.images?.length
    ? [
        { type: "text", text: message.content },
        ...message.images.map((image) => ({
          type: "image_url",
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
      ]
    : message.content;

export function foldSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  const instructions = systemText(messages),
    rest = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ ...message }));
  if (!instructions) return rest;
  const firstUser = rest.findIndex((message) => message.role === "user");
  const prefix = `[HƯỚNG DẪN HỆ THỐNG]\n${instructions}\n\n[NỘI DUNG NGƯỜI DÙNG]\n`;
  if (firstUser >= 0)
    rest[firstUser] = {
      ...rest[firstUser]!,
      content: prefix + rest[firstUser]!.content,
    };
  else rest.unshift({ role: "user", content: prefix });
  return rest;
}

export function buildProviderRequest(
  format: AIFormat,
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  options: { temperature: number; maxTokens: number },
): ProviderRequest {
  const base = trim(baseUrl);
  if (format === "anthropic")
    return {
      url: base.endsWith("/messages") ? base : `${base}/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        system: systemText(messages),
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: anthropicContent(m) })),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      },
    };
  if (format === "gemini")
    return {
      url: base.endsWith(":generateContent")
        ? base
        : `${base}/models/${encodeURIComponent(model)}:generateContent`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: {
        systemInstruction: { parts: [{ text: systemText(messages) }] },
        contents: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: geminiParts(m),
          })),
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
        },
      },
    };
  return {
    url: base.endsWith("/chat/completions") ? base : `${base}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      messages: messages.map((message) => ({
        role: message.role,
        content: openAIContent(message),
      })),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      ...(isDeepSeekBase(base) ? { thinking: { type: "disabled" } } : {}),
    },
  };
}

export function parseProviderResponse(format: AIFormat, json: any): string {
  const root = json?.data ?? json;
  let value: unknown;
  if (format === "anthropic")
    value =
      root?.content?.find?.((part: any) => part?.type === "text")?.text ??
      root?.content?.[0]?.text;
  else if (format === "gemini")
    value = root?.candidates?.[0]?.content?.parts
      ?.map?.((part: any) => part?.text ?? "")
      .join("");
  else
    value =
      root?.choices?.[0]?.message?.content ??
      root?.choices?.[0]?.text ??
      root?.output_text ??
      root?.response;
  if (Array.isArray(value))
    value = value
      .map((part: any) =>
        typeof part === "string" ? part : (part?.text ?? ""),
      )
      .join("");
  if (typeof value !== "string" || !value.trim())
    throw new Error("AI API trả về nội dung rỗng hoặc sai định dạng");
  return value.trim();
}
