import { describe, it, expect, beforeEach, vi } from "vitest";

const ENV_BASE = {
  NODE_ENV: "test",
  UPLOAD_STORAGE: "local",
  UPLOAD_LOCAL_PATH: "./uploads",
  UPLOAD_S3_BUCKET: "",
  UPLOAD_S3_REGION: "",
  UPLOAD_S3_ENDPOINT: "",
  UPLOAD_S3_KEY: "",
  UPLOAD_S3_SECRET: "",
  UPLOAD_R2_ACCOUNT_ID: "",
  UPLOAD_R2_JURISDICTION: "",
};

/** Resolved client config values may be plain or provider functions depending on SDK version. */
async function resolveConfigValue<T>(value: T | (() => Promise<T>)): Promise<T> {
  return typeof value === "function" ? await (value as () => Promise<T>)() : value;
}

const loggerMock = {
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
};

async function loadFactory(envOverrides: Partial<typeof ENV_BASE>) {
  vi.resetModules();
  vi.doMock("../src/core/config/env.js", () => ({ env: { ...ENV_BASE, ...envOverrides } }));
  vi.doMock("../src/core/logging/logger.js", () => loggerMock);
  const factory = await import("../src/core/storage/storage-factory.js");
  const { LocalStoragePort } = await import("../src/core/storage/local-storage.js");
  const { S3StoragePort } = await import("../src/core/storage/s3-storage.js");
  return { ...factory, LocalStoragePort, S3StoragePort };
}

beforeEach(() => {
  vi.doUnmock("../src/core/config/env.js");
  vi.doUnmock("../src/core/logging/logger.js");
});

describe("createStoragePort", () => {
  it("returns local storage by default", async () => {
    const { createStoragePort, LocalStoragePort } = await loadFactory({});
    const port = createStoragePort();
    expect(port).toBeInstanceOf(LocalStoragePort);
    expect(port.backend).toBe("local");
  });

  it("returns S3 storage when UPLOAD_STORAGE=s3 and config is complete", async () => {
    const { createStoragePort, S3StoragePort } = await loadFactory({
      UPLOAD_STORAGE: "s3",
      UPLOAD_S3_BUCKET: "documents",
      UPLOAD_S3_REGION: "garage",
      UPLOAD_S3_ENDPOINT: "http://garage-s3.objectstore.svc.cluster.local:3900",
      UPLOAD_S3_KEY: "k",
      UPLOAD_S3_SECRET: "s",
    });
    const port = createStoragePort();
    expect(port).toBeInstanceOf(S3StoragePort);
    expect(port.backend).toBe("s3");
  });

  it("falls back to local storage with a warning when S3 config is incomplete outside production", async () => {
    const { createStoragePort, LocalStoragePort } = await loadFactory({
      UPLOAD_STORAGE: "s3",
      UPLOAD_S3_BUCKET: "documents",
      // endpoint / key / secret / region missing
    });
    const port = createStoragePort();
    expect(port).toBeInstanceOf(LocalStoragePort);
  });

  it("fails loudly at boot in production when S3 config is incomplete", async () => {
    const { createStoragePort } = await loadFactory({
      NODE_ENV: "production",
      UPLOAD_STORAGE: "s3",
      UPLOAD_S3_BUCKET: "documents",
      UPLOAD_S3_REGION: "garage",
      UPLOAD_S3_ENDPOINT: "http://garage:3900",
      // key + secret missing
    });
    expect(() => createStoragePort()).toThrow(/UPLOAD_S3_KEY, UPLOAD_S3_SECRET/);
  });

  it("returns R2 storage (backend 'r2') deriving the account endpoint + region 'auto'", async () => {
    const { createStoragePort, S3StoragePort } = await loadFactory({
      UPLOAD_STORAGE: "r2",
      UPLOAD_S3_BUCKET: "t-abc123",
      UPLOAD_S3_KEY: "k",
      UPLOAD_S3_SECRET: "s",
      UPLOAD_R2_ACCOUNT_ID: "acc0011",
      // no endpoint, no region → derived
    });
    const port = createStoragePort();
    expect(port).toBeInstanceOf(S3StoragePort);
    expect(port.backend).toBe("r2");
    const client = (port as InstanceType<typeof S3StoragePort>).client;
    await expect(resolveConfigValue(client.config.region)).resolves.toBe("auto");
    const endpoint = await resolveConfigValue(client.config.endpoint!);
    expect(endpoint).toMatchObject({ hostname: "acc0011.r2.cloudflarestorage.com" });
  });

  it("derives the EU-jurisdiction endpoint for R2 when UPLOAD_R2_JURISDICTION=eu", async () => {
    const { createStoragePort, S3StoragePort } = await loadFactory({
      UPLOAD_STORAGE: "r2",
      UPLOAD_S3_BUCKET: "t-abc123",
      UPLOAD_S3_KEY: "k",
      UPLOAD_S3_SECRET: "s",
      UPLOAD_R2_ACCOUNT_ID: "acc0011",
      UPLOAD_R2_JURISDICTION: "eu",
    });
    const client = (createStoragePort() as InstanceType<typeof S3StoragePort>).client;
    const endpoint = await resolveConfigValue(client.config.endpoint!);
    expect(endpoint).toMatchObject({ hostname: "acc0011.eu.r2.cloudflarestorage.com" });
  });

  it("honours an explicit UPLOAD_S3_ENDPOINT override in R2 mode", async () => {
    const { createStoragePort, S3StoragePort } = await loadFactory({
      UPLOAD_STORAGE: "r2",
      UPLOAD_S3_BUCKET: "t-abc123",
      UPLOAD_S3_KEY: "k",
      UPLOAD_S3_SECRET: "s",
      UPLOAD_S3_ENDPOINT: "http://localhost:9000",
      // account id absent — the explicit endpoint stands in for it
    });
    const client = (createStoragePort() as InstanceType<typeof S3StoragePort>).client;
    const endpoint = await resolveConfigValue(client.config.endpoint!);
    expect(endpoint).toMatchObject({ hostname: "localhost", port: 9000 });
  });

  it("fails loudly at boot in production when R2 has neither account id nor endpoint", async () => {
    const { createStoragePort } = await loadFactory({
      NODE_ENV: "production",
      UPLOAD_STORAGE: "r2",
      UPLOAD_S3_BUCKET: "t-abc123",
      UPLOAD_S3_KEY: "k",
      UPLOAD_S3_SECRET: "s",
      // no account id, no endpoint → endpoint cannot be derived
    });
    expect(() => createStoragePort()).toThrow(/UPLOAD_R2_ACCOUNT_ID\/UPLOAD_S3_ENDPOINT/);
  });
});
