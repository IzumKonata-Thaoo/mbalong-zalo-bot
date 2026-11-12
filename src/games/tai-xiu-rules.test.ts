import { describe, expect, it } from "vitest";
import {
  formatBetAmount,
  parseTaiXiu,
  resolveTaiXiu,
} from "./tai-xiu-rules.js";

describe("tài xỉu", () => {
  it("accepts only an integer amount without currency suffix", () => {
    expect(parseTaiXiu("/tx tài 1000")).toEqual({
      kind: "bet",
      choice: "tai",
      amount: 1000n,
    });
    expect(parseTaiXiu("/tx xỉu 10k")).toEqual({ kind: "invalid" });
  });
  it("treats triples as house wins", () => {
    expect(resolveTaiXiu([6, 6, 6])).toBe("triple");
    expect(resolveTaiXiu([4, 4, 3])).toBe("tai");
    expect(resolveTaiXiu([1, 3, 6])).toBe("xiu");
  });
  it("uses Vietnamese words for amounts from one million", () => {
    expect(formatBetAmount(999_999n)).toBe("999.999");
    expect(formatBetAmount(1_000_000n)).toBe("1 triệu");
    expect(formatBetAmount(1_500_000n)).toBe("1,5 triệu");
    expect(formatBetAmount(2_000_000_000n)).toBe("2 tỷ");
  });
  it("keeps arbitrarily large bets exact instead of applying the JavaScript safe-integer limit", () => {
    expect(parseTaiXiu("/tx tài 999999999999999999999999999999999999")).toEqual(
      {
        kind: "bet",
        choice: "tai",
        amount: 999999999999999999999999999999999999n,
      },
    );
    expect(formatBetAmount(999999999999999999999999999999999999n)).toBe(
      "999,99 triệu tỷ tỷ tỷ",
    );
  });
});
