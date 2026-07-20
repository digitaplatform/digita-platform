import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";
import { LocalStoragePort } from "./local-storage.js";
import { S3StoragePort } from "./s3-storage.js";
import type { StoragePort } from "./storage-port.js";

const log = createLogger("storage");

/**
 * Cloudflare R2 S3-API endpoint for an account, optionally in the EU
 * jurisdiction (data stored + processed only in the EU — the platform
 * default for tenant buckets). Returns "" when the account id is unknown so
 * the incomplete-config guard below catches it instead of building a bogus
 * host.
 */
function r2Endpoint(accountId: string, jurisdiction: string): string {
  if (!accountId) return "";
  const juris = jurisdiction === "eu" ? ".eu" : "";
  return `https://${accountId}${juris}.r2.cloudflarestorage.com`;
}

/**
 * Select the file-storage backend from env.UPLOAD_STORAGE.
 *
 * "s3" (Garage) and "r2" (Cloudflare R2) share one S3-wire driver; they differ
 * only in how endpoint + region are resolved: R2 derives its per-account
 * endpoint from UPLOAD_R2_ACCOUNT_ID (+ optional EU jurisdiction) unless
 * UPLOAD_S3_ENDPOINT is given, and defaults region to "auto".
 *
 * Fail-closed philosophy (mirrors the destructive-reseed guard): an incomplete
 * object-storage configuration in production aborts boot — silently falling
 * back to a pod-local disk would lose customer files on the next restart. In
 * dev/test the same situation only warns and falls back to local disk.
 */
export function createStoragePort(): StoragePort {
  if (env.UPLOAD_STORAGE === "s3" || env.UPLOAD_STORAGE === "r2") {
    const isR2 = env.UPLOAD_STORAGE === "r2";
    const endpoint = isR2
      ? env.UPLOAD_S3_ENDPOINT || r2Endpoint(env.UPLOAD_R2_ACCOUNT_ID, env.UPLOAD_R2_JURISDICTION)
      : env.UPLOAD_S3_ENDPOINT;
    const region = isR2 ? env.UPLOAD_S3_REGION || "auto" : env.UPLOAD_S3_REGION;

    const missing = (
      [
        ["UPLOAD_S3_BUCKET", env.UPLOAD_S3_BUCKET],
        ["UPLOAD_S3_REGION", region],
        [isR2 ? "UPLOAD_R2_ACCOUNT_ID/UPLOAD_S3_ENDPOINT" : "UPLOAD_S3_ENDPOINT", endpoint],
        ["UPLOAD_S3_KEY", env.UPLOAD_S3_KEY],
        ["UPLOAD_S3_SECRET", env.UPLOAD_S3_SECRET],
      ] as [string, string][]
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      if (env.NODE_ENV === "production") {
        throw new Error(
          `UPLOAD_STORAGE=${env.UPLOAD_STORAGE} but object-storage configuration is incomplete — missing: ${missing.join(", ")}. ` +
            "Refusing to boot with a silent local-disk fallback in production.",
        );
      }
      log.warn(
        { missing, backend: env.UPLOAD_STORAGE },
        `UPLOAD_STORAGE=${env.UPLOAD_STORAGE} but object-storage configuration is incomplete — falling back to local storage (dev only)`,
      );
      const fallback = new LocalStoragePort(env.UPLOAD_LOCAL_PATH);
      log.info({ backend: "local", path: env.UPLOAD_LOCAL_PATH }, "File storage initialized");
      return fallback;
    }

    const port = new S3StoragePort({
      bucket: env.UPLOAD_S3_BUCKET,
      region,
      endpoint,
      accessKeyId: env.UPLOAD_S3_KEY,
      secretAccessKey: env.UPLOAD_S3_SECRET,
      backend: isR2 ? "r2" : "s3",
    });
    log.info(
      { backend: isR2 ? "r2" : "s3", bucket: env.UPLOAD_S3_BUCKET, endpoint, region },
      "File storage initialized",
    );
    return port;
  }

  const port = new LocalStoragePort(env.UPLOAD_LOCAL_PATH);
  log.info({ backend: "local", path: env.UPLOAD_LOCAL_PATH }, "File storage initialized");
  return port;
}
