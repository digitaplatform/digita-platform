import { posix } from "path";
import sharp from "sharp";
import type { StoragePort } from "./storage-port.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("image-variants");

/** The widths a public image is served at (`?w=`), for the breakpoints a page's srcset names. A
 *  fixed set bounds the work and storage each image can cost. */
export const IMAGE_VARIANT_WIDTHS = [320, 640, 960, 1280, 1920] as const;

export type ImageVariantWidth = (typeof IMAGE_VARIANT_WIDTHS)[number];

export type ImageVariantFormat = "webp" | "avif";

const VARIANT_FORMATS: readonly ImageVariantFormat[] = ["webp", "avif"];

/** The decode pixel budget the thumbnail keeps too: a small file can declare a huge bitmap, and the
 *  route that decodes it is anonymous. */
const MAX_PIXELS = 40_000_000;

/** Raster types sharp decodes. Any other file has no width to scale to. */
const VARIANT_SOURCES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/avif"]);

export function parseVariantWidth(raw: unknown): ImageVariantWidth | null {
  return IMAGE_VARIANT_WIDTHS.find((w) => String(w) === raw) ?? null;
}

export function hasImageVariants(mimetype: string | undefined): boolean {
  if (!mimetype) return false;
  return VARIANT_SOURCES.has((mimetype.split(";")[0] ?? "").trim().toLowerCase());
}

/** AVIF only for a browser that says it reads it; WebP for every other one. */
export function variantFormatFor(accept: string | undefined): ImageVariantFormat {
  const types = (accept ?? "").split(",").map((part) => (part.split(";")[0] ?? "").trim().toLowerCase());
  return types.includes("image/avif") ? "avif" : "webp";
}

/**
 * Where the variant of a stored file lives: beside it, named by the width and the stored name, which
 * is the content hash for every upload with a storage_path. Files that share one blob share its
 * variants, as they share its thumbnail.
 */
export function variantKey(storageKey: string, width: number, format: ImageVariantFormat): string {
  const dir = posix.dirname(storageKey);
  const base = posix.basename(storageKey, posix.extname(storageKey));
  const name = `w${width}-${base}.${format}`;
  return dir === "." ? name : `${dir}/${name}`;
}

/** Every key a variant of this blob can have, so a delete reaches the ones that were made. */
export function allVariantKeys(storageKey: string): string[] {
  return IMAGE_VARIANT_WIDTHS.flatMap((w) => VARIANT_FORMATS.map((f) => variantKey(storageKey, w, f)));
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * The key of the variant of `storageKey` at `width` in `format`, made and stored on the first
 * request and read from storage after that. A source no wider than `width` is not enlarged: the
 * variant keeps its width and gains only the format. Returns null for a source over the pixel
 * budget or one sharp cannot decode, which is then served as it is, as a browser would get it
 * without a width.
 */
export async function ensureImageVariant(
  storage: StoragePort,
  storageKey: string,
  width: ImageVariantWidth,
  format: ImageVariantFormat,
): Promise<string | null> {
  const key = variantKey(storageKey, width, format);
  if (await storage.exists(key)) return key;
  const source = await readAll((await storage.getStream(storageKey)).stream);
  let variant: Buffer;
  try {
    const meta = await sharp(source).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS) {
      log.warn({ storageKey, width: meta.width, height: meta.height }, "image exceeds the variant pixel budget, served as it is");
      return null;
    }
    const resized = sharp(source, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width, withoutEnlargement: true });
    variant = await (format === "avif" ? resized.avif() : resized.webp()).toBuffer();
  } catch (err) {
    log.warn({ storageKey, err: (err as Error).message }, "image variant could not be made, served as it is");
    return null;
  }
  await storage.put(key, variant, `image/${format}`);
  return key;
}

/** Delete the variants made of a blob that is itself being deleted. A key never made is a no-op. */
export async function deleteImageVariants(storage: StoragePort, storageKey: string): Promise<void> {
  await Promise.all(allVariantKeys(storageKey).map((key) => storage.delete(key)));
}
