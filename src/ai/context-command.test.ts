import { describe, expect, it } from "vitest";
import { isClearContextCommand } from "./context-command.js";

describe("clear-context command", () => {
  it.each([
    "/xoacontext",
    "/reset",
    "/clear",
    "/newchat",
    "/xoa context",
    "/xóa context",
    "/Xóa ngữ cảnh",
    "/xoá bộ nhớ",
    "  /RESET  ",
  ])("accepts %s", (input) => {
    expect(isClearContextCommand(input)).toBe(true);
  });

  it.each(["xoa context", "/reset đi", "hãy /clear", "/nap 100", "/tx tài 100"])(
    "ignores %s",
    (input) => {
      expect(isClearContextCommand(input)).toBe(false);
    },
  );
});
