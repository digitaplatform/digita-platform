import { describe, it, expect, vi, afterEach } from "vitest";

// The notifier takes its settings as an argument; the engine's env module is loaded only through
// the routers it shares the Guest identity with.
vi.mock("../src/core/config/env.js", () => ({ env: {} }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: logError, fatal: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import type { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { RevalidateNotifier } from "../src/core/api/revalidate-notifier.js";

const ADMIN = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 };
const entity = (name: string, guest: Record<string, unknown> | null) =>
  ({
    name, database: "app", fields: [],
    permissions: guest ? [ADMIN, { role: "Guest", level: 0, ...guest }] : [ADMIN],
  }) as unknown as EntityDefinition;

// A published-only condition is a per-row gate: without a row the entity still grants Guest read.
const page = entity("WebPage", { select: 1, read: 1, condition: "eval:doc.status=='published'" });
const nav = entity("WebNavMenu", { select: 1, read: 1 });
const contact = entity("ContactRequest", { create: 1, write: 1 });
const internal = entity("Invoice", null);
const all = [page, nav, contact, internal];

const URL = "http://digita-web:3001/api/revalidate";
const SECRET = "shared-secret";

function notifier(settings = { REVALIDATE_URL: URL, REVALIDATE_SECRET: SECRET }): RevalidateNotifier {
  const registry = { get: (name: string) => all.find((e) => e.name === name)! } as unknown as EntityRegistry;
  return new RevalidateNotifier(new PermissionChecker(registry), settings);
}

function stubRenderer(answer: () => Promise<Response>) {
  const fetch = vi.fn((_url: string, _init: RequestInit) => answer());
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** notify() is not awaited by its caller; this waits until its post has settled. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  vi.unstubAllGlobals();
  logError.mockReset();
});

describe("RevalidateNotifier.notify", () => {
  it("PLANTED DEFECT: posts the entity's tag with the secret for an entity that grants Guest read", async () => {
    const fetch = stubRenderer(async () => Response.json({ ok: true }));
    notifier().notify("WebPage");
    await settled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-revalidate-secret"]).toBe(SECRET);
    expect(JSON.parse(String(init.body))).toEqual({ tags: ["entity:WebPage"] });
    expect(logError).not.toHaveBeenCalled();
  });

  it("PLANTED INNOCENT: posts nothing for an entity Guest may only create, or not reach at all", async () => {
    const fetch = stubRenderer(async () => Response.json({ ok: true }));
    notifier().notify("ContactRequest");
    notifier().notify("Invoice");
    await settled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs a refused post with the entity and the status", async () => {
    stubRenderer(async () => Response.json({ ok: false }, { status: 401 }));
    notifier().notify("WebPage");
    await settled();
    expect(logError).toHaveBeenCalledWith({ entities: ["WebPage"], status: 401 }, "Renderer refused the cache purge");
  });

  it("logs an unreachable renderer with the entity", async () => {
    stubRenderer(async () => { throw new TypeError("fetch failed"); });
    notifier().notify("WebNavMenu");
    await settled();
    expect(logError).toHaveBeenCalledWith({ entities: ["WebNavMenu"], err: "fetch failed" }, "Renderer cache purge failed");
  });
});

describe("RevalidateNotifier.notifyAll", () => {
  it("posts the tags of every entity that grants Guest read in one post", async () => {
    const fetch = stubRenderer(async () => Response.json({ ok: true }));
    await notifier().notifyAll(all);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({ tags: ["entity:WebPage", "entity:WebNavMenu"] });
  });
});

describe("RevalidateNotifier.assertSettings at start-up", () => {
  it("is not required while no entity grants Guest read", async () => {
    await expect(notifier({ REVALIDATE_URL: "", REVALIDATE_SECRET: "" }).assertSettings([contact, internal])).resolves.toBeUndefined();
  });

  it("names REVALIDATE_URL when an entity grants Guest read and it is missing", async () => {
    await expect(notifier({ REVALIDATE_URL: "", REVALIDATE_SECRET: SECRET }).assertSettings(all))
      .rejects.toMatchObject({ code: "setting_missing_for_guest_read", params: { setting: "REVALIDATE_URL", doctype: "WebPage" } });
  });

  it("names REVALIDATE_SECRET when an entity grants Guest read and it is missing", async () => {
    await expect(notifier({ REVALIDATE_URL: URL, REVALIDATE_SECRET: "" }).assertSettings(all))
      .rejects.toMatchObject({ code: "setting_missing_for_guest_read", params: { setting: "REVALIDATE_SECRET", doctype: "WebPage" } });
  });

  it("passes with both settings", async () => {
    await expect(notifier().assertSettings(all)).resolves.toBeUndefined();
  });
});
