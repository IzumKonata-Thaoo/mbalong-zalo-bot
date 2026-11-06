import { describe, expect, it } from "vitest";
import {
  buildProviderRequest,
  foldSystemMessages,
  parseProviderResponse,
} from "./formats.js";

describe("AI provider formats", () => {
  it("does not append chat/completions twice", () => {
    expect(
      buildProviderRequest(
        "openai",
        "https://example.test/v1/chat/completions",
        "m",
        "k",
        [{ role: "user", content: "hi" }],
        { temperature: 0, maxTokens: 10 },
      ).url,
    ).toBe("https://example.test/v1/chat/completions");
  });
  it("builds DeepSeek through the OpenAI-compatible format", () => {
    const request = buildProviderRequest(
      "openai",
      "https://api.deepseek.com",
      "deepseek-flash",
      "secret",
      [
        { role: "system", content: "Ngắn gọn" },
        { role: "user", content: "Xin chào" },
      ],
      { temperature: 0, maxTokens: 10 },
    );
    expect(request.url).toBe("https://api.deepseek.com/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer secret");
    expect((request.body as any).model).toBe("deepseek-flash");
    expect((request.body as any).thinking).toEqual({ type: "disabled" });
  });
  it("parses OpenAI, Anthropic and Gemini responses", () => {
    expect(
      parseProviderResponse("openai", {
        choices: [{ message: { content: "open" } }],
      }),
    ).toBe("open");
    expect(
      parseProviderResponse("anthropic", {
        content: [{ type: "text", text: "claude" }],
      }),
    ).toBe("claude");
    expect(
      parseProviderResponse("gemini", {
        candidates: [{ content: { parts: [{ text: "gem" }] } }],
      }),
    ).toBe("gem");
  });
  it("can fold system instructions for OpenAI-compatible APIs without system role", () => {
    expect(
      foldSystemMessages([
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hello" },
      ]),
    ).toEqual([
      {
        role: "user",
        content:
          "[HƯỚNG DẪN HỆ THỐNG]\nBe concise\n\n[NỘI DUNG NGƯỜI DÙNG]\nHello",
      },
    ]);
  });
  it("maps an image to every supported multimodal API format", () => {
    const messages = [
      {
        role: "user" as const,
        content: "Giải bài",
        images: [{ mimeType: "image/png" as const, data: "aGVsbG8=" }],
      },
    ];
    const open = buildProviderRequest(
      "openai",
      "https://example.test/v1",
      "m",
      "k",
      messages,
      { temperature: 0, maxTokens: 10 },
    ).body as any;
    const deepseek = buildProviderRequest(
      "openai",
      "https://api.deepseek.com",
      "deepseek-flash",
      "k",
      messages,
      { temperature: 0, maxTokens: 10 },
    ).body as any;
    const anthropic = buildProviderRequest(
      "anthropic",
      "https://example.test/v1",
      "m",
      "k",
      messages,
      { temperature: 0, maxTokens: 10 },
    ).body as any;
    const gemini = buildProviderRequest(
      "gemini",
      "https://example.test/v1",
      "m",
      "k",
      messages,
      { temperature: 0, maxTokens: 10 },
    ).body as any;
    expect(open.messages[0].content[1].image_url.url).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
    expect(deepseek.messages[0].content[1].image_url.url).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
    expect(anthropic.messages[0].content[1].source).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "aGVsbG8=",
    });
    expect(gemini.contents[0].parts[1].inlineData).toEqual({
      mimeType: "image/png",
      data: "aGVsbG8=",
    });
  });
});
