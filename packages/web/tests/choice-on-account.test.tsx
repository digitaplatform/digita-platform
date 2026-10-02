// @vitest-environment jsdom
// A signed-in visitor's light/dark choice on the website is kept on their account, as the app's
// button keeps it: the website takes the account's choices on every page load, so a choice kept
// only in this browser was undone by the next one. The demo user's choices stay in the browser.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CSRF_HEADER, sessionCookieNames } from "@digitaplatform/shared";
import { IDENTITY_PREFERENCE_KEYS, LOOK_COOKIE_NAME, resolveInitialMode } from "@digitaplatform/theme";
import { ThemeToggle } from "../src/components/ThemeToggle";
import { loadDeliveredIdentity } from "../src/lib/delivered-identity";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sources = { apps: ["erp"], authUrl: null, authCookieSuffix: null };
const CSRF = sessionCookieNames(undefined).CSRF;
const PREFERENCES = "/erp/api/v1/resource/UserPreference";

/** The account as the engine keeps it: the visitor's own UserPreference rows. `refuse` answers
 *  403, as the engine answers the demo user. */
let account: { _id: string; pref_key: string; value: unknown }[];
let refuse = false;
let writes: { method: string; url: string; body: unknown }[];
/** How long each answer takes, so two clicks can overlap as on a slow line. */
let latency = 0;
/** Whether the next write is refused once: with 500, or with 401 until the session is refreshed. */
let failNextWrite: 500 | 401 | null = null;

function serveAccount() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (latency) await new Promise((resolve) => setTimeout(resolve, latency));
      if (url === "https://auth.acme.example/api/v1/auth/refresh") return new Response("{}");
      if (!url.startsWith(PREFERENCES)) throw new Error(`unexpected fetch ${url}`);
      if (refuse) return new Response(JSON.stringify({ success: false, error: { code: "PERMISSION_DENIED" } }), { status: 403 });
      if (method === "GET") {
        const filters = JSON.parse(decodeURIComponent(new URL(url, "http://x").searchParams.get("filters") ?? "[]")) as [string, string, unknown][];
        const [, op, wanted] = filters[0] ?? [];
        const rows = account.filter((row) => (op === "=" ? row.pref_key === wanted : (wanted as string[]).includes(row.pref_key)));
        return new Response(JSON.stringify({ success: true, status_code: 200, data: rows }));
      }
      // A write without the CSRF cookie's value in its header is refused, as the engine refuses it.
      if ((init?.headers as Record<string, string> | undefined)?.[CSRF_HEADER] !== "token-1") {
        return new Response(JSON.stringify({ success: false, error: { code: "CSRF_MISMATCH" } }), { status: 403 });
      }
      if (failNextWrite) {
        const status = failNextWrite;
        failNextWrite = null;
        return new Response(JSON.stringify({ success: false }), { status });
      }
      const body = JSON.parse(String(init?.body)) as { pref_key?: string; value: unknown };
      // The unique index on (owner, pref_key): a second row of a key is refused.
      if (method === "POST" && account.some((row) => row.pref_key === body.pref_key)) {
        return new Response(JSON.stringify({ success: false, error: { code: "DUPLICATE_ENTRY" } }), { status: 409 });
      }
      writes.push({ method, url, body });
      if (method === "PUT") account.find((row) => url.endsWith(`/${row._id}`))!.value = body.value;
      else account.push({ _id: `P-${account.length + 1}`, pref_key: body.pref_key!, value: body.value });
      return new Response(JSON.stringify({ success: true, status_code: 200, data: {} }));
    }),
  );
}

let root: Root | null = null;

async function renderToggle() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ThemeToggle label="Toggle theme" lookCookieDomain={undefined} identity={sources} />));
  return container.querySelector("button")!;
}

/** Click the button until the page shows `mode`, as a person does. */
async function clickUntil(button: HTMLButtonElement, mode: string) {
  for (let i = 0; i < 3 && resolveInitialMode() !== mode; i++) await act(async () => button.click());
  expect(resolveInitialMode()).toBe(mode);
}

beforeEach(() => {
  account = [{ _id: "P-1", pref_key: IDENTITY_PREFERENCE_KEYS.mode, value: "light" }];
  refuse = false;
  writes = [];
  latency = 0;
  failNextWrite = null;
  document.cookie = `${CSRF}=token-1; Path=/`;
  serveAccount();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.cookie = `${CSRF}=; Path=/; Max-Age=0`;
  document.cookie = `${LOOK_COOKIE_NAME}=; Path=/; Max-Age=0`;
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a light/dark choice a signed-in visitor makes on the website", () => {
  it("PLANTED DEFECT: survives the next page load, which takes the account's choices", async () => {
    await loadDeliveredIdentity(sources);
    expect(resolveInitialMode()).toBe("light");
    const button = await renderToggle();
    await clickUntil(button, "dark");
    await vi.waitFor(() => expect(account[0]!.value).toBe("dark"));

    // The next page load stores the account's choices over this browser's, as it must for a choice
    // made in the app on another device.
    await loadDeliveredIdentity(sources);
    expect(resolveInitialMode()).toBe("dark");
    expect(writes).toEqual([{ method: "PUT", url: `${PREFERENCES}/P-1`, body: { value: "dark" } }]);
  });

  it("creates the account's row when the account holds none yet", async () => {
    account = [];
    const button = await renderToggle();
    await clickUntil(button, "dark");
    await vi.waitFor(() => expect(account).toEqual([{ _id: "P-1", pref_key: IDENTITY_PREFERENCE_KEYS.mode, value: "dark" }]));
  });

  it("PLANTED DEFECT: keeps the demo user's choice in the browser, writes nothing and logs no error", async () => {
    refuse = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadDeliveredIdentity(sources)).toBe(false);
    const button = await renderToggle();
    await clickUntil(button, "dark");
    await act(async () => {});
    expect(writes).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: shows the account's mode on the button once it arrives, so the next click goes on from it", async () => {
    account[0]!.value = "dark";
    const button = await renderToggle();
    expect(resolveInitialMode()).toBe("system");
    await act(async () => {
      await loadDeliveredIdentity(sources);
    });
    expect(resolveInitialMode()).toBe("dark");
    // From dark the button goes on to system; a button still holding the mount's system would go to light.
    await act(async () => button.click());
    expect(resolveInitialMode()).toBe("system");
  });

  it("PLANTED DEFECT: keeps the last of two quick clicks on an account without a row, one write after the other", async () => {
    account = [];
    latency = 30;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const button = await renderToggle();
    expect(resolveInitialMode()).toBe("system");
    // Two clicks without waiting: light, then dark, while the first lookup is still on its way.
    await act(async () => button.click());
    await act(async () => button.click());
    expect(resolveInitialMode()).toBe("dark");
    await vi.waitFor(() => expect(writes).toHaveLength(2), { timeout: 2000 });
    expect(writes.map((write) => write.method)).toEqual(["POST", "PUT"]);
    expect(account).toEqual([{ _id: "P-1", pref_key: IDENTITY_PREFERENCE_KEYS.mode, value: "dark" }]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: names a write the account refuses, so a choice lost on the account is not silent", async () => {
    failNextWrite = 500;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const button = await renderToggle();
    await clickUntil(button, "light");
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith("[identity] the mode could not be kept on the account", expect.any(Error)));
  });

  it("PLANTED DEFECT: asks nothing of the account without the session's CSRF cookie", async () => {
    document.cookie = `${CSRF}=; Path=/; Max-Age=0`;
    const button = await renderToggle();
    await clickUntil(button, "light");
    await act(async () => {});
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("refreshes an expired session once and keeps the choice", async () => {
    failNextWrite = 401;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const withIdp = { ...sources, authUrl: "https://auth.acme.example" };
    await act(async () => root!.render(<ThemeToggle label="Toggle theme" lookCookieDomain={undefined} identity={withIdp} />));
    await clickUntil(container.querySelector("button")!, "dark");
    await vi.waitFor(() => expect(account[0]!.value).toBe("dark"));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain("https://auth.acme.example/api/v1/auth/refresh");
  });
});
