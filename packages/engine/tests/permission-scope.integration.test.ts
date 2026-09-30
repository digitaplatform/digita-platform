import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// The engine's own env module, with its defaults: no setting switches a declared `scope` on.
// Only what the test infrastructure needs is replaced: the database URI once the replica set is
// up, and the issuer and audience, which the tokens of buildTestAuth do not carry.
vi.mock("../src/core/config/env.js", async (importOriginal) => {
  process.env["MONGODB_URI"] ??= "mongodb://127.0.0.1:1";
  const { env } = await importOriginal<typeof import("../src/core/config/env.js")>();
  return { env: {
    ...env, APP_DIRS: [] as string[], AUTH_ISSUER: undefined, AUTH_AUDIENCE: undefined,
    TRANSLATION_SEED_ON_BOOT: false, REALTIME_ENABLED: false,
  } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));
vi.mock("../src/core/cache/redis-service.js", () => ({
  RedisService: class {
    connect() { return Promise.resolve(); }
    disconnect() { return Promise.resolve(); }
    get() { return Promise.resolve(null); }
    set() { return Promise.resolve(); }
    del() { return Promise.resolve(); }
  },
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import { mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// #201: a `Member` reads a `Note` through `scope` on their email, and a `CompanyNote` through
// `scope` on `company`, a claim no token carries.
const APP_BASENAME = "digita-permission-scope-fixture";
const DB = `${APP_BASENAME}_notes`;
let fixtureRoot: string;

async function writeEntity(dir: string, name: string, scope: { field: string; user_field: string }): Promise<void> {
  await writeFile(join(dir, `${name}.entity.json`), JSON.stringify({
    name, module: "notes", database: DB, naming: { strategy: "user_set" }, title_field: "title",
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: scope.field, fieldtype: "Data", label: "Scope" },
    ],
    permissions: [
      { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
      { role: "Member", level: 0, select: 1, read: 1, scope },
    ],
  }), "utf-8");
}

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let memberToken: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  fixtureRoot = join(tmpdir(), APP_BASENAME);
  await rm(fixtureRoot, { recursive: true, force: true });
  const entities = join(fixtureRoot, "notes", "entities");
  await mkdir(entities, { recursive: true });
  await writeEntity(entities, "Note", { field: "member_email", user_field: "email" });
  await writeEntity(entities, "CompanyNote", { field: "company", user_field: "company" });
  (env as { APP_DIRS: string[] }).APP_DIRS = [fixtureRoot];

  const ta = await buildTestAuth();
  const booted = await createApp({ authn: ta.authn });
  app = booted.app;
  db = booted.db;
  await booted.startup();
  await app.ready();

  const now = new Date();
  const row = (doctype: string, _id: string, extra: Record<string, unknown>) => ({
    doctype, _id, title: _id, docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now, ...extra,
  });
  await db.insertOne("Note", row("Note", "N-A", { member_email: "a@test.local" }), DB);
  await db.insertOne("Note", row("Note", "N-B", { member_email: "b@test.local" }), DB);
  await db.insertOne("CompanyNote", row("CompanyNote", "C-1", { company: "ACME" }), DB);
  memberToken = await ta.sign({ sub: "a@test.local", email: "a@test.local", roles: ["Member"] });
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await rm(fixtureRoot, { recursive: true, force: true });
  await replSet.stop();
}, 30000);

const get = (url: string) =>
  app.inject({ method: "GET", url: `/api/v1/resource/${url}`, headers: { authorization: `Bearer ${memberToken}` } });

describe("A declared permission scope narrows its role's rows with no setting (#201)", () => {
  it("lists only the rows whose scope field holds the user's value", async () => {
    const res = await get("Note");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };
    expect(body.data.map((r) => r["_id"])).toEqual(["N-A"]);
    expect(body.meta.total).toBe(1);
  });

  it("reads the user's own row and refuses another user's row", async () => {
    expect((await get("Note/N-A")).statusCode).toBe(200);
    expect((await get("Note/N-B")).statusCode).toBe(403);
  });

  it("counts only the rows the scope admits", async () => {
    const res = await get("Note/count");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.count).toBe(1);
  });

  it("grants no row when the token lacks the scope's user_field", async () => {
    const list = await get("CompanyNote");
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([]);
    expect((await get("CompanyNote/C-1")).statusCode).toBe(403);
    expect((await get("CompanyNote/count")).json().data.count).toBe(0);
  });
});
