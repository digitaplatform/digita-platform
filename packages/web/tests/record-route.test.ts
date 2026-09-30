// The record route creates the record a record form names through the public create of the engine
// that holds it, as Guest; answers a bot like a person without doing anything; and refuses with a
// plain 403 what the entity's Guest row does not grant.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const ENV = {
  ENGINE_URL: "http://engine.internal:3000",
  ENGINE_URLS: JSON.stringify({ workshop: "http://workshop.internal:3000/" }),
  SITE_ID: "veloluck",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
};

type Answer = { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;
let engineStatus = 201;
let engineError: { code: string; detail: string } | undefined;
let address = 0;

async function loadRoute(env: Record<string, string | undefined> = ENV) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return import("../src/app/api/record/route");
}

/** A booking of the workshop app, as the Veloluck site's record form sends it. */
const booking = () => ({
  app: "workshop",
  entity: "Booking",
  values: {
    contact_name: "Ada Example",
    email: "ada@example.org",
    service_code: "basic_check",
    bike_description: "The rear brake squeaks.",
    is_ebike: true,
    preferred_at: "2026-10-05T08:30:00.000Z",
    consent_privacy: true,
    page_locale: "de",
  },
  website: "",
  rendered_at: Date.now() - 10_000,
});

type Route = { POST: (req: NextRequest) => Promise<Response> };

async function send(route: Route, body: unknown, from = `203.0.113.${++address}`, path = "/api/record"): Promise<Answer> {
  const req = new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify(body),
  });
  const res = await route.POST(req);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  engineStatus = 201;
  engineError = undefined;
  fetchMock = vi.fn(async (url: string) => {
    if (!url.includes("/api/v1/public/resource/")) throw new Error(`unexpected fetch ${url}`);
    return engineStatus < 300
      ? Response.json({ success: true, data: { _id: "BK-00001" } }, { status: engineStatus })
      : Response.json({ success: false, data: null, error: engineError }, { status: engineStatus });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/record", () => {
  it("creates the record on the engine of the app the form names, as Guest, with the visitor's address and nothing else", async () => {
    const route = await loadRoute();
    expect(await send(route, booking())).toEqual({ status: 200, body: { ok: true } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://workshop.internal:3000/api/v1/public/resource/Booking");
    expect(init.method).toBe("POST");
    const headers = Object.keys(init.headers).map((name) => name.toLowerCase());
    expect(headers).not.toContain("authorization");
    expect(headers).not.toContain("x-engine-api-key");
    // The engine limits its public create per visitor and trusts this server as the one proxy hop.
    expect(init.headers["X-Forwarded-For"]).toBe(`203.0.113.${address}`);
    // PLANTED DEFECT: the form's own keys (app, entity, the honeypot, the render time) would reach
    // the engine as fields, which it refuses; any of them in the body goes red here.
    expect(JSON.parse(String(init.body))).toEqual(booking().values);
  });

  it("posts a form that names no app to the site's own engine, which stamps the site itself", async () => {
    const route = await loadRoute();
    const { app: _app, ...form } = { ...booking(), entity: "Lead", values: { email: "ada@example.org" } };
    expect(await send(route, form)).toEqual({ status: 200, body: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://engine.internal:3000/api/v1/public/resource/Lead");
    expect(JSON.parse(String(init.body))).toEqual({ email: "ada@example.org" });
  });

  it("PLANTED DEFECT: a filled honeypot is answered like a success and creates nothing", async () => {
    const route = await loadRoute();
    expect(await send(route, { ...booking(), website: "https://spam.example" })).toEqual({ status: 200, body: { ok: true } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: refuses a post that is not JSON with 415 before it counts or reads it, so a page of another site cannot post through its visitors' browsers", async () => {
    const route = await loadRoute();
    // The types a page of another site can make a browser send without asking this server first.
    for (const type of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const req = new NextRequest("http://localhost/api/record", {
        method: "POST",
        headers: { "Content-Type": type, "x-forwarded-for": "198.51.100.30" },
        body: JSON.stringify(booking()),
      });
      expect((await route.POST(req)).status, type).toBe(415);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    // PLANTED INNOCENT: the four refusals spent none of the visitor's five sends, and JSON with a
    // charset is JSON.
    for (let i = 0; i < 5; i++) {
      const req = new NextRequest("http://localhost/api/record", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", "x-forwarded-for": "198.51.100.30" },
        body: JSON.stringify(booking()),
      });
      expect((await route.POST(req)).status).toBe(200);
    }
  });

  it("a form sent under 3 seconds after it rendered is answered like a success and creates nothing", async () => {
    const route = await loadRoute();
    expect(await send(route, { ...booking(), rendered_at: Date.now() - 1000 })).toEqual({ status: 200, body: { ok: true } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: answers 403 plainly when a field lies outside the Guest grant", async () => {
    const route = await loadRoute();
    engineStatus = 400;
    engineError = { code: "BAD_REQUEST", detail: '"internal_note" is not a field a guest may set on Booking' };
    const refused = { ...booking(), values: { ...booking().values, internal_note: "VIP" } };
    expect(await send(route, refused)).toEqual({ status: 403, body: { ok: false, message: "The form may not create this record" } });
  });

  it("PLANTED DEFECT: answers 403 plainly when the entity grants Guest no create, or its engine holds no such entity", async () => {
    const route = await loadRoute();
    engineStatus = 403;
    engineError = { code: "PERMISSION_DENIED", detail: "Permission denied: Guest cannot create Invoice" };
    expect((await send(route, { ...booking(), entity: "Invoice" })).status).toBe(403);
    engineStatus = 404;
    engineError = { code: "UNKNOWN_DOCTYPE", detail: "Unknown entity Bookings" };
    expect((await send(route, { ...booking(), entity: "Bookings" })).status).toBe(403);
  });

  it("PLANTED INNOCENT: a value the visitor left out or got wrong is their 400, not the form's 403", async () => {
    const route = await loadRoute();
    engineStatus = 400;
    engineError = { code: "VALIDATION_ERROR", detail: "contact_name is required" };
    expect((await send(route, booking())).status).toBe(400);
    engineError = { code: "FIELD_VALUE_INVALID", detail: "service_code is no option" };
    expect((await send(route, booking())).status).toBe(400);
  });

  it("answers 503 and reaches no engine for an app whose engine the site does not know", async () => {
    let route = await loadRoute();
    expect(await send(route, { ...booking(), app: "erp" })).toEqual({ status: 503, body: { ok: false, message: "The form is not configured" } });
    route = await loadRoute({ ...ENV, ENGINE_URLS: undefined });
    expect((await send(route, booking())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an entity name that could leave the resource path and values that are no field values, and reaches nothing", async () => {
    const route = await loadRoute();
    for (const entity of ["../admin", "Booking/1", "Booking?x=1", "", 7]) {
      expect((await send(route, { ...booking(), entity })).status, String(entity)).toBe(400);
    }
    for (const values of [{}, [], "contact_name=Ada", { note: { $gt: "" } }, { note: null }, { tags: ["a"] }, { note: "x".repeat(5001) }]) {
      expect((await send(route, { ...booking(), values })).status, JSON.stringify(values).slice(0, 40)).toBe(400);
    }
    const { rendered_at: _r, ...unstamped } = booking();
    expect((await send(route, unstamped)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: shares one budget per visitor with the contact sheet, so a sixth form post in the hour answers 429", async () => {
    await loadRoute();
    const contact = await import("../src/app/api/contact/route");
    const record = await import("../src/app/api/record/route");
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/WebSite")
        ? Response.json({ data: [{ _id: "veloluck", site_name: "Veloluck", contact_email: "hello@example.org" }] })
        : Response.json({ data: { _id: "x" } }, { status: 201 }),
    );
    const request = { name: "Ada", email: "ada@example.org", topic: "contact", message: "Hello.", locale: "en", page: "/en", website: "", rendered_at: Date.now() - 10_000 };
    for (let i = 0; i < 3; i++) expect((await send(record, booking(), "198.51.100.7")).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await send(contact, request, "198.51.100.7", "/api/contact")).status).toBe(200);
    expect((await send(record, booking(), "198.51.100.7")).status).toBe(429);
    expect((await send(record, booking(), "198.51.100.8")).status).toBe(200);
  });

  it("answers 429 when the engine's own budget for the visitor is spent", async () => {
    const route = await loadRoute();
    engineStatus = 429;
    engineError = { code: "RATE_LIMITED", detail: "Too many requests" };
    expect(await send(route, booking())).toEqual({ status: 429, body: { ok: false, message: "Too many requests" } });
  });

  it("answers 500 without an internal URL when the engine fails the create", async () => {
    const route = await loadRoute();
    engineStatus = 500;
    engineError = { code: "INTERNAL_ERROR", detail: "An unexpected error occurred" };
    const answer = await send(route, booking());
    expect(answer.status).toBe(500);
    expect(JSON.stringify(answer.body)).not.toMatch(/internal/);
  });
});

describe("ENGINE_URLS", () => {
  const load = async () => {
    vi.resetModules();
    return (await import("../src/config/env")).parseEngineUrls;
  };

  it("reads a JSON object of app to engine URL, without a trailing slash, and nothing when unset", async () => {
    const parseEngineUrls = await load();
    expect([...parseEngineUrls('{"workshop":"http://digita-engine-workshop.t-workshop-prod.svc.cluster.local:3000/"}')]).toEqual([
      ["workshop", "http://digita-engine-workshop.t-workshop-prod.svc.cluster.local:3000"],
    ]);
    expect(parseEngineUrls(undefined).size).toBe(0);
    expect(parseEngineUrls("").size).toBe(0);
  });

  it("PLANTED DEFECT: refuses a value that is no such object, naming the variable", async () => {
    const parseEngineUrls = await load();
    expect(() => parseEngineUrls("workshop=http://x")).toThrow("[digita-web] ENGINE_URLS must be a JSON object of app to engine URL");
    expect(() => parseEngineUrls('["http://x"]')).toThrow("[digita-web] ENGINE_URLS must be a JSON object of app to engine URL");
    expect(() => parseEngineUrls('{"workshop":3}')).toThrow('[digita-web] ENGINE_URLS names app "workshop" without an http(s) URL');
    expect(() => parseEngineUrls('{"workshop":"ftp://x"}')).toThrow('[digita-web] ENGINE_URLS names app "workshop" without an http(s) URL');
  });
});
