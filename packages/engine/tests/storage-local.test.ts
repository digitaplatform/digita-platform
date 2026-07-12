import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { LocalStoragePort } from "../src/core/storage/local-storage.js";
import { FileNotFoundInStorageError } from "../src/core/storage/storage-port.js";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

let dir: string;
let port: LocalStoragePort;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "digita-storage-"));
  port = new LocalStoragePort(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalStoragePort", () => {
  it("reports backend 'local'", () => {
    expect(port.backend).toBe("local");
  });

  it("round-trips a buffer via put/getStream", async () => {
    const content = Buffer.from("hello local storage");
    await port.put("abc.txt", content, "text/plain");

    const result = await port.getStream("abc.txt");
    const read = await streamToBuffer(result.stream);

    expect(read.equals(content)).toBe(true);
    expect(result.contentLength).toBe(content.length);
    // Local disk does not track content types.
    expect(result.contentType).toBeUndefined();
  });

  it("round-trips a stream body", async () => {
    const content = Buffer.from("streamed body content");
    await port.put("stream.bin", Readable.from(content));

    const result = await port.getStream("stream.bin");
    expect((await streamToBuffer(result.stream)).equals(content)).toBe(true);
  });

  it("preserves the historical flat on-disk layout (file directly under base path)", async () => {
    await port.put("11111111-2222-3333-4444-555555555555.pdf", Buffer.from("pdf"));
    // Pre-refactor files live flat under UPLOAD_LOCAL_PATH — same layout now.
    await expect(
      readFile(join(dir, "11111111-2222-3333-4444-555555555555.pdf"), "utf8"),
    ).resolves.toBe("pdf");
  });

  it("creates the base directory lazily on put", async () => {
    const nested = join(dir, "does-not-exist-yet");
    const lazy = new LocalStoragePort(nested);
    await lazy.put("x.txt", Buffer.from("x"));
    await expect(access(join(nested, "x.txt"))).resolves.toBeUndefined();
  });

  it("deletes a stored file", async () => {
    await port.put("gone.txt", Buffer.from("bye"));
    await port.delete("gone.txt");
    await expect(access(join(dir, "gone.txt"))).rejects.toThrow();
  });

  it("delete is idempotent for missing keys", async () => {
    await expect(port.delete("never-existed.txt")).resolves.toBeUndefined();
  });

  it("getStream rejects with FileNotFoundInStorageError for a missing key", async () => {
    await expect(port.getStream("missing.txt")).rejects.toBeInstanceOf(
      FileNotFoundInStorageError,
    );
  });

  it("stores prefixed keys (<storage_path>/<uuid><ext>) in a subdirectory", async () => {
    const content = Buffer.from("customer avatar bytes");
    await port.put("customers/11111111-2222-3333-4444-555555555555.png", content, "image/png");

    // On-disk layout mirrors the object-store key scheme.
    await expect(
      readFile(join(dir, "customers", "11111111-2222-3333-4444-555555555555.png")),
    ).resolves.toEqual(content);

    const result = await port.getStream("customers/11111111-2222-3333-4444-555555555555.png");
    expect((await streamToBuffer(result.stream)).equals(content)).toBe(true);

    await port.delete("customers/11111111-2222-3333-4444-555555555555.png");
    await expect(
      access(join(dir, "customers", "11111111-2222-3333-4444-555555555555.png")),
    ).rejects.toThrow();
  });

  it("supports one nesting level inside the storage_path (erp/customers/<uuid>)", async () => {
    await port.put("erp/customers/abc.png", Buffer.from("x"));
    await expect(readFile(join(dir, "erp", "customers", "abc.png"), "utf8")).resolves.toBe("x");
  });

  it("removes the partially written file when the source stream errors mid-upload", async () => {
    // Simulates an aborted/oversized upload: the busboy stream errors after
    // some bytes have already been piped to disk. The final key must not be
    // left holding a partial orphan blob.
    async function* failingSource() {
      yield Buffer.from("partial bytes already flushed");
      throw new Error("client disconnected");
    }
    await expect(
      port.put("customers/aborted-upload.bin", Readable.from(failingSource())),
    ).rejects.toThrow("client disconnected");
    await expect(access(join(dir, "customers", "aborted-upload.bin"))).rejects.toThrow();
  });

  it("a FAILED re-put preserves the existing shared blob at the same key", async () => {
    // Keys are content-addressed and shared across File docs (dedup); a failed
    // re-put must NOT truncate or unlink the live blob other docs point at.
    await port.put("customers/shared.bin", Buffer.from("original shared content"));

    async function* failingSource() {
      yield Buffer.from("new content that never completes");
      throw new Error("client disconnected");
    }
    await expect(
      port.put("customers/shared.bin", Readable.from(failingSource())),
    ).rejects.toThrow("client disconnected");

    // The original blob must still be intact and readable.
    const result = await port.getStream("customers/shared.bin");
    expect((await streamToBuffer(result.stream)).toString()).toBe("original shared content");
  });

  it("rejects path-like keys (traversal guard)", async () => {
    await expect(port.put("../escape.txt", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
    await expect(port.getStream("customers/../escape.txt")).rejects.toThrow(/Invalid storage key/);
    await expect(port.getStream("a/b/c/d.txt")).rejects.toThrow(/Invalid storage key/);
    await expect(port.getStream("customers//x.txt")).rejects.toThrow(/Invalid storage key/);
    await expect(port.getStream("/customers/x.txt")).rejects.toThrow(/Invalid storage key/);
    await expect(port.put("customers\\evil.txt", Buffer.from("x"))).rejects.toThrow(
      /Invalid storage key/,
    );
  });
});
