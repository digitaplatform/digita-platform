// @vitest-environment jsdom
// A signed-in visitor sees on the website what the app shows them: the choices the server keeps
// for them, and the design and signature plugins they chose, loaded the way the app loads them.
// Without a session nothing is asked and the default stays, as in the app before login.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInventory } from "@digitaplatform/plugins";
import {
  DESIGN_STORAGE_KEY,
  MODE_STORAGE_KEY,
  SIGNATURE_STORAGE_KEY,
  getSignature,
  registerSignature,
} from "@digitaplatform/theme";
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

type Route = () => Response;
function serve(routes: Record<string, Route | Route[]>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = url.startsWith("/erp/api/v1/resource/UserPreference") ? "prefs" : url;
      const route = routes[key];
      const handler = Array.isArray(route) ? route.shift() : route;
      if (!handler) throw new Error(`unexpected fetch ${url}`);
      return handler();
    }),
  );
  return calls;
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status });
const ok = (data: unknown) => json(200, { success: true, status_code: 200, messages: [], data });
const prefs = (values: Record<string, unknown>) => ok(Object.entries(values).map(([pref_key, value]) => ({ pref_key, value })));
const composition = (ids: string[], entitlements: string[]) => ok({ plugins: ids.map((id) => ({ id })), entitlements });

async function whenStylesheetRequested(designId: string) {
  await vi.waitFor(() => expect(stylesheet(designId)).toBeDefined());
  stylesheet(designId)!.dispatchEvent(new Event("load"));
}

const sources = { apps: ["erp"], authUrl: "https://acme.example/auth", authCookieSuffix: "acme1" };
const signIn = () => {
  document.cookie = "digita_csrf_acme1=token123";
};

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  document.cookie = "digita_csrf_acme1=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  root().removeAttribute("data-design");
  root().removeAttribute("data-design-variant");
  root().classList.remove("dark");
});
afterEach(() => vi.unstubAllGlobals());

describe("loadDeliveredIdentity", () => {
  it("asks nothing without a session cookie, even for a stored plugin design", async () => {
    localStorage.setItem(DESIGN_STORAGE_KEY, "material");
    const calls = serve({});
    expect(await loadDeliveredIdentity(sources)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("takes the signed-in visitor's choices from the server, and loads their plugin design and signature", async () => {
    signIn();
    const calls = serve({
      prefs: prefs({ "ui.theme_mode": "dark", "ui.design": "material", "ui.signature": "aurora" }),
      "/erp/api/v1/plugins": composition(["material", "aurora"], ["material"]),
      "/erp/plugins/index.json": json(200, inventory("material", "aurora")),
    });
    const loading = loadDeliveredIdentity(sources);
    await whenStylesheetRequested("material");
    expect(await loading).toBe(true);

    expect(calls[0]?.url).toContain("/erp/api/v1/resource/UserPreference?");
    expect(decodeURIComponent(calls[0]!.url)).toContain('["pref_key","in",["ui.theme_mode","ui.density","ui.design","ui.signature"]]');
    expect(calls[0]?.init).toMatchObject({ credentials: "include" });
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe("dark");
    expect(localStorage.getItem(SIGNATURE_STORAGE_KEY)).toBe("aurora");
    expect(root().classList.contains("dark")).toBe(true);
    expect(stylesheet("material")?.getAttribute("href")).toBe("/erp/api/v1/plugin-assets/material/1.0.0/material.css");
    expect(root().getAttribute("data-design")).toBe("material");
    expect(root().getAttribute("data-design-variant")).toBe("material");
    expect(getSignature("aurora")).toMatchObject({ id: "aurora", accent: "#123456" });
  });

  it("applies bundled choices from the server without asking for the composition", async () => {
    signIn();
    const calls = serve({ prefs: prefs({ "ui.theme_mode": "dark" }) });
    expect(await loadDeliveredIdentity(sources)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("refreshes an expired session once through the IdP, then continues", async () => {
    signIn();
    const calls = serve({
      prefs: [json(401, { success: false }), prefs({ "ui.design": "editorial" })],
      "https://acme.example/auth/api/v1/auth/refresh": json(200, { success: true }),
      "/erp/api/v1/plugins": composition(["editorial"], ["editorial"]),
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

  it("keeps the default when the session is gone for good", async () => {
    signIn();
    localStorage.setItem(DESIGN_STORAGE_KEY, "fluent");
    const calls = serve({
      prefs: json(401, { success: false }),
      "https://acme.example/auth/api/v1/auth/refresh": json(401, { success: false }),
    });
    expect(await loadDeliveredIdentity(sources)).toBe(false);
    expect(calls.map((c) => c.url.split("?")[0])).toEqual(["/erp/api/v1/resource/UserPreference", "https://acme.example/auth/api/v1/auth/refresh"]);
    expect(stylesheet("fluent")).toBeUndefined();
  });

  it("does not load a premium design the tenant is not entitled to", async () => {
    signIn();
    serve({
      prefs: prefs({ "ui.design": "ios" }),
      "/erp/api/v1/plugins": composition(["ios"], []),
      "/erp/plugins/index.json": json(200, inventory("ios", "none")),
    });
    await loadDeliveredIdentity(sources);
    expect(stylesheet("ios")).toBeUndefined();
  });
});
