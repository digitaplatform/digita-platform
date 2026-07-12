import type { Readable } from "stream";

/**
 * Thrown when a storage backend is asked for a key it does not hold.
 * Routers map this to a 404 ApiResponse.
 */
export class FileNotFoundInStorageError extends Error {
  constructor(public readonly key: string) {
    super(`File not found in storage: ${key}`);
    this.name = "FileNotFoundInStorageError";
  }
}

/** Result of a streaming read from a storage backend. */
export interface StorageGetResult {
  stream: Readable;
  /** MIME type as recorded by the backend (S3 ContentType). Local storage does not track it. */
  contentType?: string;
  /** Object size in bytes when the backend knows it. */
  contentLength?: number;
}

export type StorageBackend = "local" | "s3";

/**
 * Storage seam for uploaded files (mirrors the email-port pattern in
 * digita-auth). Implementations: LocalStoragePort (dev default, flat files
 * under UPLOAD_LOCAL_PATH) and S3StoragePort (Garage / any S3-compatible
 * store). Selected at boot by createStoragePort() from env.UPLOAD_STORAGE.
 */
export interface StoragePort {
  /** Which backend this port writes to — recorded on each File doc as storage_backend. */
  readonly backend: StorageBackend;

  /** Persist a file under `key`. Body may be a stream (preferred — uploads are piped through) or a buffer. */
  put(key: string, body: Readable | Buffer, contentType?: string): Promise<void>;

  /** Whether an object already exists under `key` — lets content-addressed
   *  uploads skip a redundant put (dedup). */
  exists(key: string): Promise<boolean>;

  /** Open a read stream for `key`. Rejects with FileNotFoundInStorageError when the key is absent. */
  getStream(key: string): Promise<StorageGetResult>;

  /** Remove `key`. Idempotent — resolves even when the key is already gone. */
  delete(key: string): Promise<void>;
}
