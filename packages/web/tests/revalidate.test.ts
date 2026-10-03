// A save the engine posts purges the renderer's reads of that entity at once, and nobody without
// the shared secret can purge.
import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath: vi.fn() }));

const ENV = {
  ENGINE_URL: "http://engine.internal:3000",
  VERSION_ENDPOINTS: "https://example.org/health",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "shared-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
};

/** Loads a module afresh under `env`, because getConfig reads the environment once. */
async function load<T>(module: () => Promise<T>, env: Record<string, string | undefined> = ENV): Promise<T> {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return module();
}

const purge = (secret: string | null) =>
  new NextRequest("http://localhost/api/revalidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "x-revalidate-secret": secret }) },
    body: JSON.stringify({ tags: ["entity:WebPage"] }),
  });

afterEach(() => {
  revalidateTag.mockReset();
  vi.unstubAllGlobals();
});

describe("POST /api/revalidate", () => {
  it("PLANTED DEFECT: purges the posted entity tag with the shared secret", async () => {
    const { POST } = await load(() => import("../src/app/api/revalidate/route"));
    const res = await POST(purge("shared-secret"));
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("entity:WebPage");
  });

  it("PLANTED INNOCENT: refuses a wrong or missing secret and purges nothing", async () => {
    const { POST } = await load(() => import("../src/app/api/revalidate/route"));
    expect((await POST(purge("wrong-secret!"))).status).toBe(401);
    expect((await POST(purge(null))).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("the renderer's config", () => {
  it("requires REVALIDATE_SECRET and names it", async () => {
    const { getConfig } = await load(() => import("../src/config/env"), { ...ENV, REVALIDATE_SECRET: undefined });
    expect(() => getConfig()).toThrow("[digita-web] missing required env var: REVALIDATE_SECRET");
  });
});

describe("a read of the engine", () => {
  it("draws active menu records stored as Check booleans", async () => {
    const fetch = vi.fn(async (url: string) => {
      const request = new URL(url);
      const filters = JSON.parse(request.searchParams.get("filters") ?? "[]") as [string, string, unknown][];
      const active = filters.find(([field]) => field === "active")?.[2];
      return Response.json({
        data: request.pathname.endsWith("/WebNavMenu") && active === true
          ? [{ _id: "active", label: "Visible active node", parent: null, href: "/about" }]
          : [],
        meta: { total_pages: 1 },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const { listNav } = await load(() => import("../src/lib/engine-client"));
    expect(await listNav("en", "header")).toEqual([{ label: "Visible active node", href: "/about" }]);
  });

  it("is cached under its entity and a menu's page-publication dependency", async () => {
    const fetch = vi.fn(async (_url: string, _init: { next?: { tags?: string[] } }) => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    const { getPage, listNav, getSite } = await load(() => import("../src/lib/engine-client"));
    await getPage("en", "about");
    await listNav("en", "header");
    await getSite();
    expect(fetch.mock.calls.map(([, init]) => init.next?.tags)).toEqual([
      ["entity:WebPage"],
      ["entity:WebNavMenu", "entity:WebPage"],
      ["entity:WebPage"],
      ["entity:WebSite"],
    ]);
  });

  it("asks for a menu's labels in the visitor's language", async () => {
    const fetch = vi.fn(async (_url: string, _init: { headers?: Record<string, string> }) => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    const { listNav } = await load(() => import("../src/lib/engine-client"));
    await listNav("de", "footer");
    const menuRead = fetch.mock.calls.find(([url]) => url.includes("/WebNavMenu?"));
    expect(menuRead?.[1].headers).toEqual({ "accept-language": "de" });
    expect(new URL(menuRead![0]).searchParams.get("filters")).toBe(JSON.stringify([["site", "=", "example"], ["location", "=", "footer"], ["active", "=", true]]));
  });
});
