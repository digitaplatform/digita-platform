/**
 * File dedup back-migration (idempotent, re-runnable).
 *
 * Uploads are content-addressed since the dedup change (key =
 * <storage_path>/<sha256><ext>), so identical content is stored ONCE going
 * forward. This script reconciles files uploaded BEFORE that change, which used
 * random-UUID keys and therefore duplicated identical content in storage:
 *
 *   1. backfills File.content_hash by reading each blob + hashing it (SHA-256);
 *   2. re-keys each File to its content-addressed key (<storage_path>/<hash><ext>);
 *   3. deletes the now-redundant duplicate blobs (an object only when NO File doc
 *      still references its key — reference-counted, so shared content survives).
 *
 * DRY-RUN by default (reports counts + reclaimable bytes, writes nothing). Pass
 * `--apply` to perform the backfill + dedup. Reads the engine env (storage
 * backend + Mongo). Legacy flat keys (/uploads/<name>, no storage_path) only get
 * their content_hash backfilled — they are not re-keyed.
 *
 * Run: pnpm --filter @digitaplatform/engine run migrate:dedupe-files [-- --apply]
 */

import { Readable } from "stream";
import { extname, basename } from "path";
import { createHash } from "crypto";
import { MongoClient, type Document } from "mongodb";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createStoragePort } from "../src/core/storage/storage-factory.js";
import { FileNotFoundInStorageError, type StoragePort } from "../src/core/storage/storage-port.js";

const APPLY = process.argv.includes("--apply");

function resolveStorageKey(doc: Document): string | null {
  if (typeof doc["storage_key"] === "string" && doc["storage_key"]) return doc["storage_key"] as string;
  const url = doc["file_url"];
  if (typeof url === "string" && url.startsWith("/uploads/")) {
    const key = basename(url);
    if (key) return key;
  }
  return null;
}

async function streamToBuffer(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of s) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

interface Entry {
  id: string;
  key: string;
  hash: string;
  canonical: string | null; // null = legacy flat key (only hash-backfilled)
  size: number;
}

async function main(): Promise<void> {
  const storage: StoragePort = createStoragePort();
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const files = client.db(env.MONGODB_CORE_DB).collection(DIGITA.COLLECTIONS.FILE);

  const docs = (await files.find({}).toArray()) as Document[];
  console.log(
    `File docs: ${docs.length} · storage backend: ${storage.backend} · mode: ${APPLY ? "APPLY" : "DRY-RUN"}`,
  );

  const entries: Entry[] = [];
  let missingBlob = 0;
  let noKey = 0;
  for (const d of docs) {
    const key = resolveStorageKey(d);
    if (!key) {
      noKey++;
      continue;
    }
    let buf: Buffer;
    try {
      buf = await streamToBuffer((await storage.getStream(key)).stream);
    } catch (err) {
      if (err instanceof FileNotFoundInStorageError) {
        console.warn(`  ! blob missing for ${d._id} (${key}) — skipped`);
        missingBlob++;
        continue;
      }
      throw err;
    }
    const hash = createHash("sha256").update(buf).digest("hex");
    const slash = key.lastIndexOf("/");
    const storagePath = slash > 0 ? key.slice(0, slash) : null;
    const canonical = storagePath ? `${storagePath}/${hash}${extname(key)}` : null;
    entries.push({ id: String(d._id), key, hash, canonical, size: buf.length });
  }

  // Group by canonical key (legacy flat keys grouped separately, not re-keyed).
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = e.canonical ?? `__legacy__:${e.hash}`;
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }

  let dupGroups = 0;
  let reclaimable = 0;
  let rekeys = 0;
  for (const [k, grp] of groups) {
    const alreadyCanonical = grp.filter((e) => e.key === e.canonical).length;
    rekeys += grp.length - alreadyCanonical;
    if (grp.length > 1) {
      dupGroups++;
      // Each redundant member's blob is reclaimable once everything points at the
      // single canonical object.
      reclaimable += grp.slice(1).reduce((s, e) => s + e.size, 0);
    }
    void k;
  }

  console.log(
    `Unique content objects: ${groups.size} · duplicate groups: ${dupGroups} · ` +
      `re-keys needed: ${rekeys} · reclaimable: ~${(reclaimable / 1024).toFixed(1)} KiB`,
  );
  console.log(`Docs without a resolvable key: ${noKey} · blobs missing in storage: ${missingBlob}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — nothing written. Re-run with `-- --apply` to backfill + dedup.");
    await client.close();
    return;
  }

  // APPLY: write canonical blobs, re-point docs, delete orphaned old keys.
  const canonicalKeys = new Set<string>();
  const oldKeys = new Set<string>();
  for (const [, grp] of groups) {
    for (const e of grp) {
      if (e.canonical) {
        // Ensure the canonical object exists exactly once.
        if (!(await storage.exists(e.canonical))) {
          const buf = await streamToBuffer((await storage.getStream(e.key)).stream);
          await storage.put(e.canonical, buf);
        }
        canonicalKeys.add(e.canonical);
        await files.updateOne(
          { _id: e.id } as Document,
          { $set: { content_hash: e.hash, storage_key: e.canonical } },
        );
        if (e.key !== e.canonical) oldKeys.add(e.key);
      } else {
        // Legacy flat key — backfill hash only.
        await files.updateOne({ _id: e.id } as Document, { $set: { content_hash: e.hash } });
      }
    }
  }

  // Delete old blobs no longer referenced (and not themselves a canonical key).
  let deleted = 0;
  for (const old of oldKeys) {
    if (canonicalKeys.has(old)) continue;
    const stillUsed = await files.countDocuments({ storage_key: old });
    if (stillUsed === 0) {
      await storage.delete(old);
      deleted++;
    }
  }

  console.log(`\nAPPLIED · re-keyed/backfilled ${entries.length} files · deleted ${deleted} redundant blobs.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
