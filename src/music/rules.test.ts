import { describe, expect, it } from "vitest";
import {
  formatDuration,
  parseMusicIntent,
  parseWebSearchCommand,
} from "./rules.js";

describe("music commands", () => {
  it("searches SoundCloud with /music and its aliases", () => {
    expect(parseMusicIntent("/music Nơi này có anh")).toEqual({
      kind: "search",
      query: "Nơi này có anh",
    });
    expect(parseMusicIntent("/MUSIC   Blinding   Lights ")).toEqual({
      kind: "search",
      query: "Blinding Lights",
    });
    expect(parseMusicIntent("/nhạc lạc trôi")).toEqual({ kind: "search", query: "lạc trôi" });
    expect(parseMusicIntent("/nhac lac troi")).toEqual({ kind: "search", query: "lac troi" });
    expect(parseMusicIntent("/sc see tình")).toEqual({ kind: "search", query: "see tình" });
    expect(parseMusicIntent("/soundcloud see tình")).toEqual({ kind: "search", query: "see tình" });
  });

  it("shows usage for a bare /music", () => {
    expect(parseMusicIntent("/music")).toEqual({ kind: "help" });
    expect(parseMusicIntent("/nhac   ")).toEqual({ kind: "help" });
  });

  it("does not treat lookalike commands as music", () => {
    expect(parseMusicIntent("/musical")).toBeNull();
    expect(parseMusicIntent("/scan abc")).toBeNull();
  });

  it("keeps natural phrasing only when SoundCloud is named", () => {
    expect(parseMusicIntent("tìm nhạc Nơi này có anh trên soundcloud")).toEqual({
      kind: "search",
      query: "Nơi này có anh",
    });
    expect(parseMusicIntent("kiếm bài Blinding Lights soundcloud")).toEqual({
      kind: "search",
      query: "Blinding Lights",
    });
    expect(parseMusicIntent("tìm nhạc Nơi này có anh")).toBeNull();
    expect(parseMusicIntent("tìm bài hát hay nhất 2026")).toBeNull();
  });

  it("parses numbered selection", () => {
    expect(parseMusicIntent("chọn 2")).toEqual({ kind: "select", index: 1 });
    expect(parseMusicIntent("/chon 2")).toEqual({ kind: "select", index: 1 });
    expect(parseMusicIntent("/chọn 3")).toEqual({ kind: "select", index: 2 });
    expect(parseMusicIntent("phát bài 6")).toEqual({ kind: "select", index: 5 });
  });

  it("does not hijack ordinary homework searches", () => {
    expect(parseMusicIntent("tìm bài toán này")).toBeNull();
  });

  it("formats duration", () => expect(formatDuration(185000)).toBe("3:05"));
});

describe("web search command", () => {
  it("parses /search and aliases", () => {
    expect(parseWebSearchCommand("/search giá vàng hôm nay")).toEqual({ query: "giá vàng hôm nay" });
    expect(parseWebSearchCommand("/web tỷ giá USD")).toEqual({ query: "tỷ giá USD" });
    expect(parseWebSearchCommand("/timkiem lịch thi")).toEqual({ query: "lịch thi" });
    expect(parseWebSearchCommand("/google")).toEqual({ query: "" });
  });
  it("ignores other text", () => {
    expect(parseWebSearchCommand("/music abc")).toBeNull();
    expect(parseWebSearchCommand("search abc")).toBeNull();
    expect(parseWebSearchCommand("/searching")).toBeNull();
  });
});
