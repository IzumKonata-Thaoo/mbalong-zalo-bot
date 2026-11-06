import { describe, expect, it } from "vitest";
import { buildGroupVoicePayload } from "./voice.js";

describe("Zalo group voice payload", () => {
  it("uses msgType 3 and the known uploaded file size", () => {
    const payload = buildGroupVoicePayload({
      groupId: "group-1",
      voiceUrl: "https://files.example.test/voice",
      fileSize: 368533,
      imei: "imei-1",
      clientId: "client-1",
    });
    expect(payload.grid).toBe("group-1");
    expect(payload.msgType).toBe(3);
    expect(JSON.parse(payload.msgInfo)).toEqual({
      voiceUrl: "https://files.example.test/voice",
      m4aUrl: "https://files.example.test/voice",
      fileSize: 368533,
    });
  });
});
