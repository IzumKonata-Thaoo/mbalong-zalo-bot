import type { ChatMessage } from "../types.js";
import { getAISettings, type AISettings } from "../settings.js";
import {
  buildProviderRequest,
  foldSystemMessages,
  parseProviderResponse,
} from "./formats.js";

export interface AIProvider {
  generate(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string>;
}

export class OpenAICompatibleProvider implements AIProvider {
  async generate(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number } = {},
    override?: AISettings,
  ): Promise<string> {
    const current = override ?? getAISettings();
    if (!current.apiKey)
      throw new Error("Chưa cấu hình API key trong web admin");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const request = buildProviderRequest(
        current.format,
        current.baseUrl,
        current.model,
        current.apiKey,
        messages,
        {
          temperature: options.temperature ?? 0.55,
          maxTokens: options.maxTokens ?? 1600,
        },
      );
      let response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      if (
        !response.ok &&
        [400, 422].includes(response.status) &&
        current.format === "openai"
      ) {
        const folded = buildProviderRequest(
          current.format,
          current.baseUrl,
          current.model,
          current.apiKey,
          foldSystemMessages(messages),
          {
            temperature: options.temperature ?? 0.55,
            maxTokens: options.maxTokens ?? 1600,
          },
        );
        const minimal: Record<string, unknown> = {
          ...(folded.body as Record<string, unknown>),
        };
        delete minimal.temperature;
        delete minimal.max_tokens;
        response = await fetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(minimal),
          signal: controller.signal,
        });
      }
      if (!response.ok) {
        const detail = await response
          .json()
          .then((body: any) => body?.error?.message ?? body?.message ?? "")
          .catch(() => "");
        const providerName = (() => {
          try {
            return new URL(current.baseUrl).hostname === "api.deepseek.com"
              ? "DeepSeek"
              : current.format;
          } catch {
            return current.format;
          }
        })();
        if (response.status === 401)
          throw new Error(
            `${providerName}: API key không hợp lệ hoặc đã bị thu hồi (401)`,
          );
        throw new Error(
          `AI API ${providerName} từ chối yêu cầu (${response.status}${detail ? `: ${String(detail).slice(0, 300)}` : ""})`,
        );
      }
      return parseProviderResponse(current.format, await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  async test(settings?: AISettings) {
    const current = settings ?? getAISettings();
    return this.generate(
      [
        ...(current.systemPrompt
          ? [{ role: "system" as const, content: current.systemPrompt }]
          : []),
        { role: "user", content: "Trả lời đúng một từ: OK" },
      ],
      { temperature: 0, maxTokens: 8 },
      current,
    );
  }
}

export const ai = new OpenAICompatibleProvider();
