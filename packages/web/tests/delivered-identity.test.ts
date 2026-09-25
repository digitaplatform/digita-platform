// @vitest-environment jsdom
// A signed-in visitor sees the design and the signature they chose in the app on the website too,
// loaded the way the app loads them; an anonymous visitor keeps the default, as in the app before
// login.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInventory } from "@digitaplatform/plugins";
import { DESIGN_STORAGE_KEY, SIGNATURE_STORAGE_KEY, getSignature, registerSignature } from "@digitaplatform/theme";
import { signature as bundledDefault } from "@digitaplatform/digita";
import { loadDeliveredIdentity } from "../src/lib/delivered-identity";

// The page's pre-paint boot registers the signature it bundles before anything else runs.
registerSignature(bundledDefault);

const root = () => document.documentElement;
const stylesheet = (designId: string) =>
  [...document.head.querySelectorAll<HTMLLinkElement>("link[data-design-plugin]")].find(
    (link) => link.getAttribute("data-design-plugin") === designId,
  );

const inventory = (designId: string, signatureId: string): PluginInventory => ({
  schemaVersion: 1,
  plugins: [
    { id: designId, type: "design", tier: "premium", version: "1.0.0", url: `/api/v1/plugin-assets/${designId}/1.0.0/${designId}.css` },
    { id: signatureId, type: "signature", tier: "free", version: "1.0.0", accent: "#123456" },
  ],
});

type Route = (init?: RequestInit) => Response;
function serve(routes: Record<string, Route | Route[]>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const route = routes[url];
      const handler = Array.isArray(route) ? route.shift() : route;
      if (!handler) throw new Error(`unexpected fetch ${url}`);
      return handler(init);
    }),
  );
  return calls;
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status });
const composition = (ids: string[], entitlements: string[]) =>
  json(200, { success: true, status_code: 200, messages: [], data: { plugins: ids.map((id) => ({ id })), entitlements } });

async function whenStylesheetRequested(designId: string) {
  await vi.waitFor(() => expect(stylesheet(designId)).toBeDefined());
  stylesheet(designId)!.dispatchEvent(new Event("load"));
}

const sources = { apps: ["erp"], authUrl: "https://acme.example/auth", authCookieSuffix: "acme1" };

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  document.cookie = "digita_csrf_acme1=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  root().removeAttribute("data-design");
  root().removeAttribute("data-design-variant");
});
afterEach(() => vi.unstubAllGlobals());

describe("loadDeliveredIdentity", () => {
  it("asks no app when the stored design and signature ship with the page", async () => {
    const calls = serve({});
    expect(await loadDeliveredIdentity(sources)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("loads the signed-in visitor's design and signature from the app, and applies them in order", async () => {
    localStorage.setItem(DESIGN_STORAGE_KEY, "material");
    localStorage.setItem(SIGNATURE_STORAGE_KEY, "aurora");
    const calls = serve({
      "/erp/api/v1/plugins": composition(["material", "aurora"], ["material"]),
      "/erp/plugins/index.json": json(200, inventory("material", "aurora")),
    });
    const loading = loadDeliveredIdentity(sources);
    await whenStylesheetRequested("material");
    expect(await loading).toBe(true);

    expect(calls[0]).toMatchObject({ url: "/erp/api/v1/plugins", init: { credentials: "include" } });
    expect(stylesheet("material")?.getAttribute("href")).toBe("/erp/api/v1/plugin-assets/material/1.0.0/material.css");
    expect(root().getAttribute("data-design")).toBe("material");
    expect(root().getAttribute("data-design-variant")).toBe("material");
    expect(getSignature("aurora")).toMatchObject({ id: "aurora", accent: "#123456" });
  });

  it("keeps the default for an anonymous visitor, without trying a refresh", async () => {
    localStorage.setItem(DESIGN_STORAGE_KEY, "fluent");
    const calls = serve({ "/erp/api/v1/plugins": json(401, { success: false }) });
    expect(await loadDeliveredIdentity(sources)).toBe(false);
    expect(calls.map((c) => c.url)).toEqual(["/erp/api/v1/plugins"]);
    expect(stylesheet("fluent")).toBeUndefined();
  });

  it("refreshes an expired session once through the IdP, then loads the design", async () => {
    localStorage.setItem(DESIGN_STORAGE_KEY, "editorial");
    document.cookie = "digita_csrf_acme1=token123";
    const calls = serve({
      "/erp/api/v1/plugins": [json(401, { success: false }), composition(["editorial"], ["editorial"])],
      "https://acme.example/auth/api/v1/auth/refresh": json(200, { success: true }),
      "/erp/plugins/index.json": json(200, inventory("editorial", "none")),
    });
    const loading = loadDeliveredIdentity(sources);
    await whenStylesheetRequested("editorial");
    expect(await loading).toBe(true);

    const refresh = calls.find((c) => c.url.endsWith("/auth/refresh"));
    expect(refresh?.init).toMatchObject({ method: "POST", credentials: "include", body: "{}" });
    expect((refresh?.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("token123");
    expect(root().getAttribute("data-design")).toBe("editorial");
  });

  it("does not load a premium design the tenant is not entitled to", async () => {
    localStorage.setItem(DESIGN_STORAGE_KEY, "ios");
    serve({
      "/erp/api/v1/plugins": composition(["ios"], []),
      "/erp/plugins/index.json": json(200, inventory("ios", "none")),
    });
    expect(await loadDeliveredIdentity(sources)).toBe(false);
    expect(stylesheet("ios")).toBeUndefined();
  });
});
