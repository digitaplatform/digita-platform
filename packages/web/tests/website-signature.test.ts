// A site that names no look of its own wears the website look the tenant's settings name:
// BrandingSetting.web_default_signature of the tenant's apps (ENGINE_URLS), read from each app's
// anonymous boot. The apps that name one must agree; when they name different looks, the site
// wears digita and the log names them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

Object.assign(process.env, {
  ENGINE_URL: "http://site.internal:3000",
  ENGINE_URLS: JSON.stringify({
    show: "http://site.internal:3000",
    workshop: "http://workshop.internal:3000",
    crm: "http://crm.internal:3000",
  }),
  SITE_ID: "veloluck",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
});

const { findWebsiteSignature } = await import("../src/lib/engine-client");
const { siteSignature } = await import("../src/lib/identity");

/** The website look each engine's settings name, by the first label of its host; an Error: no
 *  answer; a Response: that answer. */
let looks: Record<string, string | Error | Response> = {};
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  const look = looks[new URL(url).hostname.split(".")[0]!];
  if (look instanceof Error) throw look;
  if (look instanceof Response) return look;
  return Response.json({ success: true, data: { branding: look ? { web_default_signature: look } : {} } });
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the website look", () => {
  it("a site without a theme wears the look the one app names, and a site with a theme keeps its own", async () => {
    looks = { workshop: "veloluck-workbench" };
    const look = await findWebsiteSignature();
    expect(look).toBe("veloluck-workbench");
    expect(fetchMock).toHaveBeenCalledWith("http://workshop.internal:3000/api/v1/boot", expect.anything());
    expect(siteSignature(undefined, look).id).toBe("veloluck-workbench");
    expect(siteSignature("", look).id).toBe("veloluck-workbench");
    expect(siteSignature("digita", look).id).toBe("digita");
  });

  it("apps that name the same look agree on it", async () => {
    looks = { workshop: "veloluck-lakeside", crm: "veloluck-lakeside" };
    expect(await findWebsiteSignature()).toBe("veloluck-lakeside");
  });

  it("apps that name different looks leave the site on digita, and the log names them", async () => {
    looks = { workshop: "veloluck-workbench", crm: "veloluck-precise" };
    const look = await findWebsiteSignature();
    expect(look).toBeUndefined();
    expect(siteSignature(undefined, look).id).toBe("digita");
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("workshop: veloluck-workbench");
    expect(logged).toContain("crm: veloluck-precise");
  });

  it("without a look named by any app the site wears digita", async () => {
    looks = {};
    expect(await findWebsiteSignature()).toBeUndefined();
    expect(siteSignature(undefined, undefined).id).toBe("digita");
  });

  it("asks every app with a time limit, so an app that hangs cannot hold the page", async () => {
    looks = { workshop: "veloluck-workbench" };
    await findWebsiteSignature();
    for (const [, init] of fetchMock.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("an app that answers with an error is logged, and the others still name the look", async () => {
    looks = { crm: new Response("", { status: 503 }), workshop: "veloluck-workbench" };
    expect(await findWebsiteSignature()).toBe("veloluck-workbench");
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toMatch(/"crm".*503/);
  });

  it("logs a disagreement once, not on every page", async () => {
    looks = { workshop: "veloluck-workbench", crm: "simetrix" };
    await findWebsiteSignature();
    await findWebsiteSignature();
    const logged = vi.mocked(console.error).mock.calls.filter((call) => String(call[0]).includes("different website looks"));
    expect(logged).toHaveLength(1);
  });

  it("a site theme the renderer does not bundle falls to the website look, and is logged once", async () => {
    expect(siteSignature("acme", "veloluck-workbench").id).toBe("veloluck-workbench");
    expect(siteSignature("acme", undefined).id).toBe("digita");
    const logged = vi.mocked(console.error).mock.calls.filter((call) => String(call[0]).includes('"acme"'));
    expect(logged).toHaveLength(1);
  });

  it("an app that does not answer is logged, and the others still name the look", async () => {
    looks = { crm: new Error("unreachable"), workshop: "veloluck-workbench" };
    expect(await findWebsiteSignature()).toBe("veloluck-workbench");
    expect(console.error).toHaveBeenCalled();
  });
});
