import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderMarketImage } from "./market-image.js";
import { createVirtualMarket } from "./market-rules.js";

describe("virtual market chart", () => {
  it("renders a Zalo-ready 1280x720 PNG", async () => {
    const now = Date.UTC(2026, 10, 9, 10, 15, 30);
    const image = await renderMarketImage(createVirtualMarket("group-1", now), now);
    const metadata = await sharp(image).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(720);
  });
});
