import { afterEach, describe, expect, it, vi } from "vitest";
import { createReplicaFixture } from "./cloud-mongo.js";

afterEach(() => vi.unstubAllEnvs());

describe("cloud Mongo fixture boundary", () => {
  it("fails when the run ID has no sidecar URI", async () => {
    vi.stubEnv("DIGITA_TEST_RUN_ID", "12345678-1234-1234-1234-123456789abc");
    vi.stubEnv("DIGITA_TEST_MONGODB_URI", "");
    await expect(createReplicaFixture()).rejects.toThrow("requires run ID and URI");
  });
  it.each(["production.example.com", "localhost", "10.1.1.2"])("refuses %s before connecting", async (host) => {
    vi.stubEnv("DIGITA_TEST_RUN_ID", "12345678-1234-1234-1234-123456789abc");
    vi.stubEnv("DIGITA_TEST_MONGODB_URI", `mongodb://${host}:27017/?replicaSet=rs0&directConnection=true`);
    await expect(createReplicaFixture()).rejects.toThrow("run-owned loopback replica set");
  });
  it.each([
    "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true&proxyHost=production.example.com",
    "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true&directConnection=false",
    "mongodb://127.0.0.1:27017/tenant?replicaSet=rs0&directConnection=true",
    "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true#fragment",
  ])("refuses extra URI options before connecting", async (uri) => {
    vi.stubEnv("DIGITA_TEST_RUN_ID", "12345678-1234-1234-1234-123456789abc");
    vi.stubEnv("DIGITA_TEST_MONGODB_URI", uri);
    await expect(createReplicaFixture()).rejects.toThrow("run-owned loopback replica set");
  });
});
