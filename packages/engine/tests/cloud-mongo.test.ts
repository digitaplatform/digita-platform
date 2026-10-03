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
});
