import { describe, expect, it } from "vitest";
import { formatDuration, parseMusicIntent } from "./rules.js";

describe("music commands", () => {
  it("parses natural SoundCloud searches", () => {
    expect(parseMusicIntent("tìm nhạc Nơi này có anh trên soundcloud")).toEqual(
      { kind: "search", query: "Nơi này có anh" },
    );
    expect(parseMusicIntent("kiếm bài Blinding Lights soundcloud")).toEqual({
      kind: "search",
      query: "Blinding Lights",
    });
  });
  it("parses numbered selection without adding a user menu", () => {
    expect(parseMusicIntent("chọn 2")).toEqual({ kind: "select", index: 1 });
    expect(parseMusicIntent("/chon 2")).toEqual({ kind: "select", index: 1 });
    expect(parseMusicIntent("phát bài 6")).toEqual({
      kind: "select",
      index: 5,
    });
  });
  it("does not hijack ordinary homework searches", () => {
    expect(parseMusicIntent("tìm bài toán này")).toBeNull();
  });
  it("formats duration", () => expect(formatDuration(185000)).toBe("3:05"));
});
