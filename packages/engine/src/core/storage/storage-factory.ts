import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";
import { LocalStoragePort } from "./local-storage.js";
import { S3StoragePort } from "./s3-storage.js";
import type { StoragePort } from "./storage-port.js";

const log = createLogger("storage");

/**
 * Select the file-storage backend from env.UPLOAD_STORAGE.
 *
 * Fail-closed philosophy (mirrors the destructive-reseed guard): an
 * incomplete S3 configuration in production aborts boot — silently falling
 * back to a pod-local disk would lose customer files on the next restart.
 * In dev/test the same situation only warns and falls back to local disk.
 */
export function createStoragePort(): StoragePort {
  if (env.UPLOAD_STORAGE === "s3") {
    const missing = (
      [
        ["UPLOAD_S3_BUCKET", env.UPLOAD_S3_BUCKET],
        ["UPLOAD_S3_REGION", env.UPLOAD_S3_REGION],
        ["UPLOAD_S3_ENDPOINT", env.UPLOAD_S3_ENDPOINT],
        ["UPLOAD_S3_KEY", env.UPLOAD_S3_KEY],
        ["UPLOAD_S3_SECRET", env.UPLOAD_S3_SECRET],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      if (env.NODE_ENV === "production") {
        throw new Error(
          `UPLOAD_STORAGE=s3 but S3 configuration is incomplete — missing: ${missing.join(", ")}. ` +
            "Refusing to boot with a silent local-disk fallback in production.",
        );
      }
      log.warn(
        { missing },
        "UPLOAD_STORAGE=s3 but S3 configuration is incomplete — falling back to local storage (dev only)",
      );
      const fallback = new LocalStoragePort(env.UPLOAD_LOCAL_PATH);
      log.info({ backend: "local", path: env.UPLOAD_LOCAL_PATH }, "File storage initialized");
      return fallback;
    }

    const port = new S3StoragePort({
      bucket: env.UPLOAD_S3_BUCKET,
      region: env.UPLOAD_S3_REGION,
      endpoint: env.UPLOAD_S3_ENDPOINT,
      accessKeyId: env.UPLOAD_S3_KEY,
      secretAccessKey: env.UPLOAD_S3_SECRET,
    });
    log.info(
      { backend: "s3", bucket: env.UPLOAD_S3_BUCKET, endpoint: env.UPLOAD_S3_ENDPOINT, region: env.UPLOAD_S3_REGION },
      "File storage initialized",
    );
    return port;
  }

  const port = new LocalStoragePort(env.UPLOAD_LOCAL_PATH);
  log.info({ backend: "local", path: env.UPLOAD_LOCAL_PATH }, "File storage initialized");
  return port;
}
