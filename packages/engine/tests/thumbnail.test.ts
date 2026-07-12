// H5: the pure-JS image decoder has no pixel cap, so a tiny file declaring huge
// dimensions (e.g. 20000×20000 in a ~30KB PNG) would allocate a ~1.6GB bitmap
// and OOM-kill the pod. makeThumbnail now parses the header dimensions first and
// skips anything above the pixel budget (or any format it can't size).
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { imageDimensions, makeThumbnail } from "../src/core/storage/thumbnail.js";

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  b[0] = 0x89;
  b[1] = 0x50;
  b[2] = 0x4e;
  b[3] = 0x47;
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe("thumbnail H5 — pixel-budget guard", () => {
  it("parses PNG header dimensions without decoding", () => {
    expect(imageDimensions(png(20000, 20000))).toEqual({ width: 20000, height: 20000 });
  });

  it("parses a GIF header", () => {
    const b = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x00, 0x20, 0x00]);
    expect(imageDimensions(b)).toEqual({ width: 0x40, height: 0x20 });
  });

  it("skips thumbnailing a decompression-bomb-sized image (null, never decodes)", async () => {
    // 20000×20000 = 400 MP, far above the 40 MP budget → skipped before decode.
    expect(await makeThumbnail(png(20000, 20000))).toBeNull();
  });

  it("returns null for an unsizable/unknown format (safe skip)", async () => {
    expect(await makeThumbnail(Buffer.from("this is not an image at all"))).toBeNull();
  });
});
