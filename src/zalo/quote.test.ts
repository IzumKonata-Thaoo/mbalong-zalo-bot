import { describe, expect, it } from "vitest";
import { normalizeZaloQuote } from "./quote.js";

describe("normalize Zalo reply quote", () => {
  it("converts listener TQuote into sendMessage SendMessageQuote", () => {
    expect(
      normalizeZaloQuote({
        ownerId: "bot-uid",
        cliMsgId: 123,
        globalMsgId: 456,
        cliMsgType: 1,
        ts: 1700000000000,
        msg: "🎧 KẾT QUẢ SOUNDCLOUD",
        attach: "",
        fromD: "MbaLong",
        ttl: 0,
      }),
    ).toEqual({
      content: "🎧 KẾT QUẢ SOUNDCLOUD",
      msgType: "webchat",
      propertyExt: undefined,
      uidFrom: "bot-uid",
      msgId: "456",
      cliMsgId: "123",
      ts: "1700000000000",
      ttl: 0,
    });
  });
});
