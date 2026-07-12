import { createReadStream, createWriteStream } from "fs";
import { mkdir, stat, unlink, rename } from "fs/promises";
import { join, dirname } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  FileNotFoundInStorageError,
  type StorageGetResult,
  type StoragePort,
} from "./storage-port.js";

/**
 * Keys are server-generated: `<storage_path>/<uuid><ext>` where storage_path
 * is one or two validated segments, plus legacy flat `<uuid><ext>` names.
 * Allow at most 3 safe segments — anything else is rejected (traversal guard).
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function splitKey(key: string): string[] {
  const segments = key.split("/");
  if (
    segments.length === 0 ||
    segments.length > 3 ||
    segments.some((s) => !s || s === "." || s === ".." || !SAFE_SEGMENT.test(s))
  ) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return segments;
}

/**
 * Local-disk storage backend. Mirrors the object-store key scheme on disk:
 * `<storage_path>/<uuid><ext>` becomes a subdirectory under
 * UPLOAD_LOCAL_PATH; legacy flat `<uuid><ext>` keys (pre-StoragePort
 * uploads) keep resolving directly under the base path.
 */
export class LocalStoragePort implements StoragePort {
  readonly backend = "local" as const;

  constructor(private readonly basePath: string) {}

  /** Keys are server-generated names — reject anything path-like beyond the validated prefix scheme. */
  private resolveKey(key: string): string {
    return join(this.basePath, ...splitKey(key));
  }

  async put(key: string, body: Readable | Buffer, _contentType?: string): Promise<void> {
    const filePath = this.resolveKey(key);
    await mkdir(dirname(filePath), { recursive: true });
    const source = Buffer.isBuffer(body) ? Readable.from(body) : body;
    // Keys are content-addressed and SHARED across File docs (dedup), and the
    // upload path re-puts unconditionally (H6 blob repair). Writing in place
    // would truncate a live blob for concurrent readers, and unlinking the
    // final key on failure would destroy the blob every other File doc points
    // at. So write to a unique temp file in the same directory and rename()
    // onto the final key — atomic on the same filesystem; open reader fds keep
    // the old inode. A failed write only ever removes its own temp file.
    const tmpPath = `${filePath}.tmp-${randomUUID()}`;
    try {
      await pipeline(source, createWriteStream(tmpPath));
      await rename(tmpPath, filePath);
    } catch (err) {
      // Best-effort cleanup of the temp file only — never touch the final key,
      // which may hold a blob other File docs still reference. The original
      // error is what the caller needs to see.
      try {
        await unlink(tmpPath);
      } catch {
        /* temp already gone or never created */
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const stats = await stat(this.resolveKey(key));
      return stats.isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  async getStream(key: string): Promise<StorageGetResult> {
    const filePath = this.resolveKey(key);
    let size: number;
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) throw new FileNotFoundInStorageError(key);
      size = stats.size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FileNotFoundInStorageError(key);
      }
      throw err;
    }
    return { stream: createReadStream(filePath), contentLength: size };
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveKey(key);
    try {
      await unlink(filePath);
    } catch (err) {
      // Idempotent — a missing file is already the desired end state.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
