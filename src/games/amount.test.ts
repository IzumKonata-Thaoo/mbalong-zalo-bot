import { describe, expect, it } from "vitest";
import { amountAtEnd, parseVietnameseAmount } from "./amount.js";
import { formatBetAmount } from "./tai-xiu-rules.js";

describe("Vietnamese game amounts", () => {
  it("parses plain, million, decimal billion and repeated-billion units", () => {
    expect(parseVietnameseAmount("1.000.000")).toBe(1_000_000n);
    expect(parseVietnameseAmount("2 triệu")).toBe(2_000_000n);
    expect(parseVietnameseAmount("1,5 tỷ")).toBe(1_500_000_000n);
    expect(parseVietnameseAmount("3 tỷ tỷ")).toBe(3_000_000_000_000_000_000n);
    expect(parseVietnameseAmount("1 tỷ tỷ tỷ")).toBe(10n ** 27n);
  });

  it("extracts the stake at the end of a challenge", () => {
    expect(amountAtEnd("/pk @Đối Thủ 2 tỷ tỷ")).toBe(2n * 10n ** 18n);
    expect(amountAtEnd("/pk @Đối Thủ 1.250.000")).toBe(1_250_000n);
  });

  it("formats arbitrarily large repeated-billion values", () => {
    expect(formatBetAmount(10n ** 27n)).toBe("1 tỷ tỷ tỷ");
    expect(formatBetAmount(2n * 10n ** 30n)).toBe("2 nghìn tỷ tỷ tỷ");
  });
});
