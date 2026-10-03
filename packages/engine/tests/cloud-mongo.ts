import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

export type ReplicaFixture = Pick<MongoMemoryReplSet, "getUri" | "stop">;

// The cloud sidecar belongs to one PipelineRun. Serial files reuse its process;
// database cleanup here replaces removal of each memory-server fixture's data.
async function cloudFixture() {
  const runId = process.env.DIGITA_TEST_RUN_ID;
  const value = process.env.DIGITA_TEST_MONGODB_URI;
  if (!runId && !value) return undefined;
  if (!runId || !value) throw new Error("cloud Mongo fixture requires run ID and URI");
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(runId)) {
    throw new Error("cloud Mongo fixture requires a PipelineRun UID");
  }
  const uri = new URL(value);
  if (uri.protocol !== "mongodb:" || uri.hostname !== "127.0.0.1" ||
      uri.port !== "27017" || uri.username || uri.password ||
      uri.searchParams.get("replicaSet") !== "rs0" ||
      uri.searchParams.get("directConnection") !== "true") {
    throw new Error("cloud Mongo fixture only accepts the run-owned loopback replica set");
  }
  const client = new MongoClient(value, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  async function clearFixtureData() {
    const { databases } = await client.db("admin").admin().listDatabases({ nameOnly: true });
    for (const { name } of databases) {
      if (!["admin", "config", "local", "digita_test_fixture"].includes(name)) await client.db(name).dropDatabase();
    }
  }
  try {
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.isWritablePrimary || hello.setName !== "rs0") {
      throw new Error("cloud Mongo sidecar is not the writable rs0 primary");
    }
    const owner = await client.db("digita_test_fixture")
      .collection<{ _id: string; runID: string }>("owner")
      .findOne({ _id: "pipeline-run" });
    if (owner?.runID !== runId) {
      throw new Error("cloud Mongo sidecar has no matching run ownership marker");
    }
    await clearFixtureData();
  } catch (error) {
    await client.close();
    throw error;
  }
  return {
    getUri(dbName?: string) {
      const address = new URL(value);
      if (dbName) address.pathname = "/" + encodeURIComponent(dbName);
      return address.toString();
    },
    async stop() {
      try { await clearFixtureData(); } finally { await client.close(); }
      return true;
    },
  };
}

export async function createReplicaFixture(options?: Parameters<typeof MongoMemoryReplSet.create>[0]): Promise<ReplicaFixture> {
  return (await cloudFixture()) ?? MongoMemoryReplSet.create(options);
}
