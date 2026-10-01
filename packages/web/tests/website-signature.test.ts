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

/** The website look each engine's settings name, by the first label of its host; an Error: no answer. */
let looks: Record<string, string | Error> = {};
const fetchMock = vi.fn(async (url: string) => {
  const look = looks[new URL(url).hostname.split(".")[0]!];
  if (look instanceof Error) throw look;
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

  it("an app that does not answer is logged, and the others still name the look", async () => {
    looks = { crm: new Error("unreachable"), workshop: "veloluck-workbench" };
    expect(await findWebsiteSignature()).toBe("veloluck-workbench");
    expect(console.error).toHaveBeenCalled();
  });
});
