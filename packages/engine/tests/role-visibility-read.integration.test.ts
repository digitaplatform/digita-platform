import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// The engine's own env module, with its defaults. Only what the test infrastructure needs is
// replaced: the database URI once the replica set is up, and the issuer and audience, which the
// tokens of buildTestAuth do not carry.
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
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// The visitor of a demo tenant signs in as a user who holds only roles of the app, here the
// workshop's Reception and Technician, which the IdP hands out as `workshop:` roles. Home lists
// the workspaces that user may read and opens one, so the workspaces that name one of its roles
// are readable to it, and nothing else of the dashboards is.
let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth("workshop");
  const booted = await createApp({ authn: ta.authn });
  app = booted.app;
  db = booted.db;
  await booted.startup();
  await app.ready();

  const now = new Date();
  const row = (doctype: string, _id: string, extra: Record<string, unknown>) => ({
    doctype, _id, docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now, ...extra,
  });
  const workspace = (_id: string, roles: string[], priority: number, defaultView: string) =>
    row("Workspace", _id, {
      name: _id, enabled: true, priority, roles, is_default_for_roles: roles, default_view: defaultView,
      cards: [{ id: "open", kind: "number", label: "Open", section: "open", value_field: "count" }],
    });
  // The shapes of the workshop's seeds: one workspace per role, a lead's that names the
  // Administrator too, and one with no role list, which every System User sees.
  await db.insertOne("Workspace", workspace("workshop-lead", ["WorkshopLead", "Administrator"], 5, "workshop-overview"), "core");
  await db.insertOne("Workspace", workspace("workshop-reception", ["Reception"], 10, "workshop-overview"), "core");
  await db.insertOne("Workspace", workspace("workshop-technician", ["Technician"], 20, "technician-board"), "core");
  await db.insertOne("Workspace", workspace("everyone", [], 50, "workshop-overview"), "core");
  for (const view of ["workshop-overview", "technician-board", "utilization"]) {
    await db.insertOne("View", row("View", view, { name: view, enabled: true, anchored: false, sections: [] }), "core");
  }

  const sign = (sub: string, roles: string[]) => ta.sign({ sub, email: sub, roles });
  tokens["demo"] = await sign("demo@show.test", ["workshop:Reception", "workshop:Technician", "report:Viewer"]);
  tokens["reception"] = await sign("reception@show.test", ["workshop:Reception"]);
  tokens["other-app"] = await sign("viewer@show.test", ["report:Viewer"]);
  tokens["system"] = await sign("system@show.test", ["System User"]);
  tokens["system-reception"] = await sign("desk@show.test", ["System User", "workshop:Reception"]);
  tokens["admin"] = await sign("admin@show.test", ["Administrator"]);
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

const call = (user: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url: `/api/v1/${url}`, headers: { authorization: `Bearer ${tokens[user]}` }, payload });
const get = (user: string, url: string) => call(user, "GET", url);

async function listedWorkspaces(user: string): Promise<string[]> {
  const res = await get(user, "resource/Workspace?order_by=priority%20asc");
  expect(res.statusCode).toBe(200);
  const body = res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };
  expect(body.meta.total).toBe(body.data.length);
  return body.data.map((w) => String(w["_id"]));
}

describe("A user who holds only roles of the app reads the workspaces that name one of its roles", () => {
  it("lists exactly the workspaces that name one of its roles", async () => {
    expect(await listedWorkspaces("demo")).toEqual(["workshop-reception", "workshop-technician"]);
    expect(await listedWorkspaces("reception")).toEqual(["workshop-reception"]);
  });

  it("opens a workspace that names its role, whole, and no other workspace", async () => {
    const own = await get("reception", "resource/Workspace/workshop-reception");
    expect(own.statusCode).toBe(200);
    expect(own.json().data).toMatchObject({ roles: ["Reception"], default_view: "workshop-overview", cards: [{ id: "open" }] });
    for (const other of ["workshop-technician", "workshop-lead", "everyone"]) {
      expect((await get("reception", `resource/Workspace/${other}`)).statusCode).toBe(403);
    }
  });

  it("counts and finds in a link picker only the workspaces that name its role", async () => {
    expect((await get("reception", "resource/Workspace/count")).json().data.count).toBe(1);
    const picked = await get("reception", "search/Workspace?q=e");
    expect(picked.statusCode).toBe(200);
    expect((picked.json().data as Array<{ _id: string }>).map((w) => w._id)).toEqual(["workshop-reception"]);
  });

  it("writes, creates and deletes no workspace", async () => {
    expect((await call("reception", "PUT", "resource/Workspace/workshop-reception", { priority: 1 })).statusCode).toBe(403);
    expect((await call("reception", "POST", "resource/Workspace", { _id: "mine", name: "Mine", roles: ["Reception"], cards: [] })).statusCode).toBe(403);
    expect((await call("reception", "DELETE", "resource/Workspace/workshop-reception")).statusCode).toBe(403);
  });

  it("reads no View definition, listed or opened, and finds none in the global search", async () => {
    expect((await get("demo", "resource/View")).statusCode).toBe(403);
    expect((await get("demo", "resource/View/count")).statusCode).toBe(403);
    for (const view of ["workshop-overview", "technician-board", "utilization"]) {
      expect((await get("demo", `resource/View/${view}`)).statusCode).toBe(403);
    }
    const found = await get("demo", "search?q=workshop");
    expect(found.statusCode).toBe(200);
    expect((found.json().data as Array<{ entity: string }>).filter((hit) => hit.entity === "View")).toEqual([]);
  });

  it("reads no workspace through a role of another app", async () => {
    expect((await get("other-app", "resource/Workspace")).statusCode).toBe(403);
  });
});

describe("A System User or an Administrator reads the workspaces as before", () => {
  it("shows a System User the workspaces with no role list or its own role", async () => {
    expect(await listedWorkspaces("system")).toEqual(["everyone"]);
    expect(await listedWorkspaces("system-reception")).toEqual(["workshop-reception", "everyone"]);
    expect((await get("system", "resource/View/utilization")).statusCode).toBe(200);
  });

  it("shows an Administrator every workspace", async () => {
    expect(await listedWorkspaces("admin")).toEqual(["workshop-lead", "workshop-reception", "workshop-technician", "everyone"]);
  });
});
