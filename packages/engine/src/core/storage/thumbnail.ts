import Jimp from "jimp";
import { createLogger } from "../logging/logger.js";

const log = createLogger("thumbnail");

/** Longest-edge size of a generated thumbnail (px). */
const MAX_EDGE = 256;

/** Decode pixel budget (H5). The pure-JS decoder allocates a full bitmap with
 *  no cap, so a ~30KB file declaring 20000×20000 would allocate ~1.6GB and
 *  OOM-kill the pod. 40 megapixels is far above any legitimate thumbnail source. */
const MAX_PIXELS = 40_000_000;

/** Raster image types jimp can decode. SVG is refused at upload (scriptable);
 *  webp is not supported by this decoder → no thumbnail (falls back to original). */
const THUMBNAILABLE = new Set(["image/jpeg", "image/png", "image/bmp", "image/tiff", "image/gif"]);

export function isThumbnailable(mimetype: string | undefined): boolean {
  if (!mimetype) return false;
  return THUMBNAILABLE.has((mimetype.split(";")[0] ?? "").trim().toLowerCase());
}

/**
 * Parse image width×height from the header WITHOUT decoding pixels. Covers PNG,
 * GIF, BMP and JPEG. Returns null for anything it can't size (incl. TIFF) — the
 * caller then skips thumbnailing rather than risk an unbounded decode.
 */
export function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG: 8-byte signature, IHDR width @16 / height @20 (big-endian).
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: "GIF", logical-screen width @6 / height @8 (little-endian 16-bit).
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // BMP: "BM", width @18 / height @22 (little-endian 32-bit; height may be negative).
  if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return { width: buf.readUInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
  }
  // JPEG: SOI then scan segments for a Start-Of-Frame marker.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1]!;
      // SOF0..SOF15 carry the dimensions; exclude the non-frame markers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2); // skip this segment
    }
  }
  return null;
}

/**
 * Resize an image buffer to a `<= MAX_EDGE` PNG thumbnail (aspect preserved).
 * Returns null on any decode/processing error or when the source exceeds the
 * pixel budget — thumbnailing is best-effort, the original image is always the
 * fallback, so a corrupt or oversized upload never fails (and never OOMs).
 */
export async function makeThumbnail(buffer: Buffer): Promise<Buffer | null> {
  // H5: bound the decode BEFORE handing the buffer to the uncapped decoder.
  const dims = imageDimensions(buffer);
  if (!dims || dims.width <= 0 || dims.height <= 0 || dims.width * dims.height > MAX_PIXELS) {
    if (dims) {
      log.warn(
        { width: dims.width, height: dims.height },
        "image exceeds thumbnail pixel budget (or unsizable) — skipping",
      );
    }
    return null;
  }
  try {
    const img = await Jimp.read(buffer);
    img.scaleToFit(MAX_EDGE, MAX_EDGE);
    return await img.getBufferAsync(Jimp.MIME_PNG);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "thumbnail generation failed — skipping");
    return null;
  }
}
