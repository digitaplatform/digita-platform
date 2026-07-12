/**
 * ADR-12 P4 — identity-ref data migration (idempotent, re-runnable).
 *
 * Since P3 the engine has NO User entity; Permission.user / Log.user /
 * DocShare.shared_with / shared_by are plain identity refs (the user id IS
 * the email, keyed by digita-auth). Because User._id was already the email,
 * existing Link values stay valid as plain string refs — this migration only
 *
 *   1. backfills denormalized display names:
 *        Log.user_name           (logs db)      — from identity User.full_name
 *        DocShare.shared_with_name / shared_by_name (identity db)
 *      Fallback: the email itself when the user is not found. Rows already
 *      carrying a name are skipped → re-running is a no-op.
 *
 *   2. refreshes the Entity meta-collection (core db) — the DB is the
 *      runtime source of truth (registry.loadFromDb), so the stale rows
 *      must be reconciled with the new file definitions:
 *        - deletes the `User` entity row (entity removed from the engine)
 *        - replaces Permission / Log / DocShare / Salesperson rows with
 *          their current file definitions (Link → Data + name fields)
 *
 * Reads connection config from the engine env (root .env.development).
 * The engine READS the identity store (digita-auth owns it) — the only
 * identity-db writes here are the DocShare name backfills, and DocShare
 * is an engine-owned collection that merely lives in the identity db.
 *
 * Run: pnpm --filter @digitaplatform/engine run migrate:identity
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { MongoClient, type Collection, type Document } from "mongodb";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

const REFRESH_ENTITIES = ["Permission", "Log", "DocShare", "Salesperson"];

async function main(): Promise<void> {
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  console.log(`Connected: ${env.MONGODB_URI}`);
  console.log(
    `Databases: identity=${env.MONGODB_IDENTITY_DB} logs=${env.MONGODB_LOGS_DB} core=${env.MONGODB_CORE_DB}`,
  );

  const identityDb = client.db(env.MONGODB_IDENTITY_DB);
  const userCol = identityDb.collection(DIGITA.COLLECTIONS.USER);

  // Cached read-only identity lookup: user id (email) → display name.
  const nameCache = new Map<string, string>();
  async function displayNameFor(userId: string): Promise<string> {
    const key = userId.trim().toLowerCase();
    const cached = nameCache.get(key);
    if (cached !== undefined) return cached;
    const row = await userCol.findOne({ _id: key } as Document);
    const name = (row as { full_name?: string } | null)?.full_name ?? userId;
    nameCache.set(key, name);
    return name;
  }

  // ─── 1a. Log.user_name backfill (logs db) ──────────────────────────
  const logCol: Collection<Document> = client
    .db(env.MONGODB_LOGS_DB)
    .collection(DIGITA.COLLECTIONS.LOG);

  let logUpdated = 0;
  let logSkippedNoUser = 0;
  const missingNameFilter = {
    $or: [{ user_name: { $exists: false } }, { user_name: null }],
  };
  const distinctUsers = (await logCol.distinct("user", missingNameFilter)) as unknown[];
  for (const u of distinctUsers) {
    if (typeof u !== "string" || u === "") {
      logSkippedNoUser += await logCol.countDocuments({ ...missingNameFilter, user: u as never });
      continue;
    }
    const name = await displayNameFor(u);
    const res = await logCol.updateMany(
      { ...missingNameFilter, user: u },
      { $set: { user_name: name } },
    );
    logUpdated += res.modifiedCount;
  }

  // ─── 1b. DocShare name backfills (identity db) ─────────────────────
  const dsCol = identityDb.collection(DIGITA.COLLECTIONS.DOC_SHARE);
  let dsUpdated = 0;
  const dsCursor = dsCol.find({
    $or: [
      { shared_with_name: { $exists: false } },
      { shared_with_name: null },
      { shared_by_name: { $exists: false } },
      { shared_by_name: null },
    ],
  });
  for await (const row of dsCursor) {
    const set: Record<string, string> = {};
    if (
      (row["shared_with_name"] === undefined || row["shared_with_name"] === null) &&
      typeof row["shared_with"] === "string" &&
      row["shared_with"] !== ""
    ) {
      set["shared_with_name"] = await displayNameFor(row["shared_with"]);
    }
    if (
      (row["shared_by_name"] === undefined || row["shared_by_name"] === null) &&
      typeof row["shared_by"] === "string" &&
      row["shared_by"] !== ""
    ) {
      set["shared_by_name"] = await displayNameFor(row["shared_by"]);
    }
    if (Object.keys(set).length > 0) {
      await dsCol.updateOne({ _id: row["_id"] }, { $set: set });
      dsUpdated++;
    }
  }

  // ─── 2. Entity meta-collection reconciliation (core db) ────────────
  // The registry boots file-first but then overwrites from the DB
  // (`loadFromDb` — DB wins), so stale rows would resurrect the User
  // entity and the old Link fields. Delete User, refresh the four
  // converted definitions from their files.
  const entityCol = client.db(env.MONGODB_CORE_DB).collection(DIGITA.COLLECTIONS.ENTITY);

  const delUser = await entityCol.deleteOne({ _id: "User" } as Document);

  const registry = new EntityRegistry();
  await registry.loadAll(env.ENTITIES_DIR);
  // Salesperson lives in the erp app (domain-split layout). Resolve it the
  // same way APP_DIRS does, but only the master domain is needed here.
  for (const appDir of env.APP_DIRS) {
    const masterEntities = resolve(appDir, "master/entities");
    if (existsSync(masterEntities)) {
      await registry.loadAll(masterEntities);
    }
  }

  let entityRefreshed = 0;
  const entityMissing: string[] = [];
  for (const name of REFRESH_ENTITIES) {
    const file = registry.getFileEntity(name);
    if (!file) {
      entityMissing.push(name);
      continue;
    }
    const existing = await entityCol.findOne({ _id: name } as Document);
    const doc: Document = {
      _id: name,
      ...JSON.parse(JSON.stringify(file)),
      owner: (existing?.["owner"] as string) ?? "system",
      modified_by: "migrate-identity-refs",
      creation: (existing?.["creation"] as Date) ?? new Date(),
      modified: new Date(),
    };
    await entityCol.replaceOne({ _id: name } as Document, doc, { upsert: true });
    entityRefreshed++;
  }

  console.log("\n─── migrate-identity-refs summary ───");
  console.log(`Log.user_name backfilled:            ${logUpdated}`);
  console.log(`Log rows skipped (no user value):    ${logSkippedNoUser}`);
  console.log(`DocShare rows name-backfilled:       ${dsUpdated}`);
  console.log(`Entity row "User" deleted:           ${delUser.deletedCount}`);
  console.log(`Entity definitions refreshed:        ${entityRefreshed} (${REFRESH_ENTITIES.filter((n) => !entityMissing.includes(n)).join(", ")})`);
  if (entityMissing.length > 0) {
    console.log(`Entity files not found (skipped):    ${entityMissing.join(", ")}`);
  }
  console.log("Idempotent — re-running is safe.\n");

  await client.close();
}

main().catch((err) => {
  console.error("migrate-identity-refs failed:", err);
  process.exitCode = 1;
});
