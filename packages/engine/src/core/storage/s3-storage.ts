import { Readable } from "stream";
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import {
  FileNotFoundInStorageError,
  type StorageGetResult,
  type StoragePort,
} from "./storage-port.js";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Which backend to record on each File doc as storage_backend. Defaults to
   * "s3" (Garage). The R2 preset in createStoragePort() passes "r2" so logs
   * and File metadata name the real store, even though the wire client is
   * identical (R2 is S3-compatible).
   */
  backend?: "s3" | "r2";
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/**
 * S3-compatible storage backend. Serves two stores through one wire client:
 * Garage (region literally "garage") and Cloudflare R2 (region "auto",
 * per-account endpoint). PATH-STYLE addressing is REQUIRED for Garage
 * (virtual-host bucket DNS does not exist there) and ACCEPTED by R2, so
 * `forcePathStyle: true` is safe for both; the two checksum options below are
 * likewise required by BOTH Garage and R2 to avoid the multipart-CRC32
 * download-corruption bug on newer SDKs. The `backend` label ("s3"|"r2") only
 * distinguishes what gets recorded on File docs — the behavior is identical.
 */
export class S3StoragePort implements StoragePort {
  readonly backend: "s3" | "r2";
  /** Exposed for unit tests (client config assertions) — do not use directly elsewhere. */
  readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.backend = config.backend ?? "s3";
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      // Garage-compat requirement (like forcePathStyle above), verified live
      // against dxflrs/garage v1.0.1: the SDK defaults both options to
      // WHEN_SUPPORTED, which makes lib-storage's MULTIPART path (bodies
      // > 5 MiB partSize) store a multipart-composite CRC32 that Garage
      // echoes back on GetObject. The SDK then validates it as a full-object
      // checksum and EVERY download of a large object aborts mid-stream with
      // "Checksum mismatch" — the data is stored but unreadable. WHEN_REQUIRED
      // restores plain SigV4-integrity behavior and makes large uploads
      // round-trip byte-identical.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Readable | Buffer, contentType?: string): Promise<void> {
    // lib-storage Upload streams multipart for large bodies and falls back
    // to a single PutObject for small ones — no buffering of whole uploads.
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(contentType ? { ContentType: contentType } : {}),
      },
    });
    await upload.done();
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async getStream(key: string): Promise<StorageGetResult> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) throw new FileNotFoundInStorageError(key);
      return {
        // In Node the SDK's streaming payload IS a Readable (IncomingMessage).
        stream: res.Body as unknown as Readable,
        ...(res.ContentType ? { contentType: res.ContentType } : {}),
        ...(typeof res.ContentLength === "number" ? { contentLength: res.ContentLength } : {}),
      };
    } catch (err) {
      if (isNotFound(err)) throw new FileNotFoundInStorageError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      // S3 DeleteObject is idempotent by spec; tolerate stores that 404 anyway.
      if (!isNotFound(err)) throw err;
    }
  }
}
