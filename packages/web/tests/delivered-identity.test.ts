// @vitest-environment jsdom
// A signed-in visitor sees on the website what the app shows them: the choices the server keeps
// for them, and the design plugin they chose, loaded the way the app loads it.
// Without a session nothing is asked and the default stays, as in the app before login.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInventory } from "@digitaplatform/plugins";
import {
  DESIGN_STORAGE_KEY,
  MODE_STORAGE_KEY,
  PAGE_IDENTITY_ELEMENT_ID,
  SIGNATURE_STORAGE_KEY,
} from "@digitaplatform/theme";
import { signature as siteSignature } from "@digitaplatform/simetrix";
import { loadDeliveredIdentity } from "../src/lib/delivered-identity";

const root = () => document.documentElement;
const stylesheet = (designId: string) =>
  [...document.head.querySelectorAll<HTMLLinkElement>("link[data-design-plugin]")].find(
    (link) => link.getAttribute("data-design-plugin") === designId,
  );

const inventory = (designId: string): PluginInventory => ({
  schemaVersion: 1,
  plugins: [{ id: designId, type: "design", tier: "premium", version: "1.0.0", url: `/api/v1/plugin-assets/${designId}/1.0.0/${designId}.css` }],
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

const sources = { apps: ["erp"], authUrl: "https://tenant.example/auth", authCookieSuffix: "tenant1" };
const signIn = () => {
  document.cookie = "digita_csrf_tenant1=token123";
};

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  document.cookie = "digita_csrf_tenant1=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  root().removeAttribute("data-design");
  root().removeAttribute("data-design-variant");
  root().removeAttribute("data-signature");
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

  it("takes the signed-in visitor's choices from the server, and loads their plugin design", async () => {
    signIn();
    const calls = serve({
      prefs: prefs({ "ui.theme_mode": "dark", "ui.design": "material", "ui.signature": "aurora" }),
      "/erp/api/v1/plugins": composition(["material"], ["material"]),
      "/erp/plugins/index.json": json(200, inventory("material")),
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
  });

  it("keeps the site's signature when the visitor's stored one differs", async () => {
    // As in production: the pre-paint boot registered the page's signature in its own module
    // instance, so this chunk's registry is empty and the page's signatures are all it has.
    // The site's signature is not the default: were the page's signature dropped, the stored
    // `aurora` would resolve through getSignature's default fallback, and data-signature would
    // no longer be `simetrix`. A site drawn in the default `digita` could not show the difference.
    signIn();
    const page = document.createElement("script");
    page.type = "application/json";
    page.id = PAGE_IDENTITY_ELEMENT_ID;
    page.textContent = JSON.stringify({ signature: "simetrix", signatures: [siteSignature] });
    document.head.appendChild(page);
    const calls = serve({ prefs: prefs({ "ui.theme_mode": "dark", "ui.signature": "aurora" }) });

    expect(await loadDeliveredIdentity(sources)).toBe(true);

    expect(calls).toHaveLength(1);
    expect(localStorage.getItem(SIGNATURE_STORAGE_KEY)).toBe("aurora");
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().getAttribute("data-signature")).toBe("simetrix");
  });

  it("refreshes an expired session once through the IdP, then continues", async () => {
    signIn();
    const calls = serve({
      prefs: [json(401, { success: false }), prefs({ "ui.design": "editorial" })],
      "https://tenant.example/auth/api/v1/auth/refresh": json(200, { success: true }),
      "/erp/api/v1/plugins": composition(["editorial"], ["editorial"]),
      "/erp/plugins/index.json": json(200, inventory("editorial")),
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
      "https://tenant.example/auth/api/v1/auth/refresh": json(401, { success: false }),
    });
    expect(await loadDeliveredIdentity(sources)).toBe(false);
    expect(calls.map((c) => c.url.split("?")[0])).toEqual(["/erp/api/v1/resource/UserPreference", "https://tenant.example/auth/api/v1/auth/refresh"]);
    expect(stylesheet("fluent")).toBeUndefined();
  });

  it("does not load a premium design the tenant is not entitled to", async () => {
    signIn();
    serve({
      prefs: prefs({ "ui.design": "ios" }),
      "/erp/api/v1/plugins": composition(["ios"], []),
      "/erp/plugins/index.json": json(200, inventory("ios")),
    });
    await loadDeliveredIdentity(sources);
    expect(stylesheet("ios")).toBeUndefined();
  });
});
