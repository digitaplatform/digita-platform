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
 * S3-compatible storage backend, targeting Garage as the platform object
 * store. Garage specifics: region is literally "garage" and PATH-STYLE
 * addressing is REQUIRED — virtual-host bucket DNS does not exist there,
 * so `forcePathStyle: true` is non-negotiable.
 */
export class S3StoragePort implements StoragePort {
  readonly backend = "s3" as const;
  /** Exposed for unit tests (client config assertions) — do not use directly elsewhere. */
  readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
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
