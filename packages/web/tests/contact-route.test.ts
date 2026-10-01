// The contact route stores a request on the engine, answers a bot like a person without doing
// anything, and refuses invalid input, a refused create and a flood.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const ENV = {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "simetrix",
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
/** What the engine's create answers beside its status: its error body and its headers. */
let engineBody: unknown = { data: {} };
let engineHeaders: Record<string, string> = {};
let address = 0;

async function loadRoute(env: Record<string, string | undefined> = ENV) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return import("../src/app/api/contact/route");
}

const valid = () => ({
  name: "Ada Example",
  email: "ada@example.org",
  company: "Example GmbH",
  topic: "early_access",
  message: "We want to digitalize our order intake.",
  locale: "en",
  page: "/en",
  website: "",
  rendered_at: Date.now() - 10_000,
});

async function post(route: Awaited<ReturnType<typeof loadRoute>>, body: unknown, from = `203.0.113.${++address}`): Promise<Response> {
  const req = new NextRequest("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify(body),
  });
  return route.POST(req);
}

async function send(route: Awaited<ReturnType<typeof loadRoute>>, body: unknown, from?: string): Promise<Answer> {
  const res = await post(route, body, from);
  return { status: res.status, body: await res.json() };
}

const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));

beforeEach(() => {
  engineStatus = 201;
  engineBody = { data: {} };
  engineHeaders = {};
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/api/v1/public/resource/WebSite")) {
      return Response.json({ data: [{ _id: "simetrix", site_name: "simetrix", contact_email: "hello@example.org" }] });
    }
    if (url.includes("/api/v1/public/resource/ContactRequest")) return Response.json(engineBody, { status: engineStatus, headers: engineHeaders });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const HOUR = 60 * 60 * 1000;

describe("POST /api/contact", () => {
  it("creates the ContactRequest through the public create without a credential and nothing else", async () => {
    const route = await loadRoute();
    expect(await send(route, valid())).toEqual({ status: 200, body: { ok: true } });

    const [create] = calls("/api/v1/public/resource/ContactRequest");
    expect(create?.[0]).toBe("http://engine.internal:3000/api/v1/public/resource/ContactRequest");
    const createHeaders = Object.keys(create?.[1].headers).map((name) => name.toLowerCase());
    expect(createHeaders).not.toContain("x-engine-api-key");
    expect(createHeaders).not.toContain("authorization");
    // The engine limits its route per visitor and trusts this server as the one proxy hop.
    expect(create?.[1].headers["X-Forwarded-For"]).toBe(`203.0.113.${address}`);
    const { rendered_at: _r, website: _w, ...fields } = valid();
    // PLANTED DEFECT: the engine stamps the site itself and refuses a Link or a system field in the body; a `site` key goes red.
    expect(JSON.parse(create?.[1].body)).toEqual(fields);
    expect(Object.keys(JSON.parse(create?.[1].body)).sort()).toEqual(["company", "email", "locale", "message", "name", "page", "topic"]);
    expect(fetchMock.mock.calls.filter(([url]) => !String(url).includes("engine.internal"))).toHaveLength(0);
  });

  it("PLANTED DEFECT: a filled honeypot is answered like a success and reaches nothing", async () => {
    const route = await loadRoute();
    expect(await send(route, { ...valid(), website: "https://spam.example" })).toEqual({ status: 200, body: { ok: true } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: refuses a post that is not JSON with 415 before it counts or reads it, so a page of another site cannot post through its visitors' browsers", async () => {
    const route = await loadRoute();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const req = new NextRequest("http://localhost/api/contact", {
        method: "POST",
        headers: { "Content-Type": type, "x-forwarded-for": "198.51.100.31" },
        body: JSON.stringify(valid()),
      });
      expect((await route.POST(req)).status, type).toBe(415);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    // PLANTED INNOCENT: the refusals spent none of the visitor's budget.
    expect((await send(route, valid(), "198.51.100.31")).status).toBe(200);
  });

  it("a form sent under 3 seconds after it rendered is answered like a success and reaches nothing", async () => {
    const route = await loadRoute();
    expect(await send(route, { ...valid(), rendered_at: Date.now() - 1000 })).toEqual({ status: 200, body: { ok: true } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an email without a plausible shape, a topic outside the set and a line break in the name", async () => {
    const route = await loadRoute();
    expect((await send(route, { ...valid(), email: "ada@example" })).status).toBe(400);
    expect((await send(route, { ...valid(), topic: "sales" })).status).toBe(400);
    expect((await send(route, { ...valid(), name: "Ada\r\nBcc: x@example.org" })).status).toBe(400);
    expect((await send(route, { ...valid(), locale: "xx" })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: answers 503, not 500, when the engine refuses the create with 403", async () => {
    const route = await loadRoute();
    engineStatus = 403;
    // The site has no Guest create row yet; the sheet then offers the contact address.
    expect(await send(route, valid())).toEqual({ status: 503, body: { ok: false, message: "Contact is not configured" } });
  });

  it("PLANTED DEFECT: keys the limit and the forwarded address on the last x-forwarded-for entry, not on the visitor's own claim", async () => {
    const route = await loadRoute();
    // Five sends whose first entry differs each time and whose last entry, the one the ingress appended, is the same.
    for (let i = 0; i < 5; i++) expect((await send(route, valid(), `10.0.0.${i}, 198.51.100.20`)).status).toBe(200);
    expect((await send(route, valid(), "10.0.0.9, 198.51.100.20")).status).toBe(429);
    expect((await send(route, valid(), "10.0.0.9, 198.51.100.21")).status).toBe(200);
    const [create] = calls("/api/v1/public/resource/ContactRequest");
    expect(create?.[1].headers["X-Forwarded-For"]).toBe("198.51.100.20");
  });

  it("PLANTED DEFECT: answers 429 to the sixth request in an hour from one address and 200 again once the hour has passed", async () => {
    vi.useFakeTimers();
    const route = await loadRoute();
    for (let i = 0; i < 5; i++) expect((await send(route, valid(), "198.51.100.7")).status).toBe(200);
    expect((await send(route, valid(), "198.51.100.7")).status).toBe(429);
    expect((await send(route, valid(), "198.51.100.8")).status).toBe(200);
    // The window is the route's own, so a wrong RATE_WINDOW_MS or a swapped constructor argument goes red here.
    vi.advanceTimersByTime(HOUR - 1);
    expect((await send(route, valid(), "198.51.100.7")).status).toBe(429);
    vi.advanceTimersByTime(1);
    expect((await send(route, valid(), "198.51.100.7")).status).toBe(200);
  });

  it("PLANTED DEFECT: passes the engine's 400 through with the field it names, so the sheet names the field to correct", async () => {
    const route = await loadRoute();
    engineStatus = 400;
    engineBody = { error: { code: "VALIDATION_ERROR", field: "email" } };
    expect(await send(route, valid())).toEqual({ status: 400, body: { ok: false, message: "Invalid request", field: "email" } });
  });

  it("PLANTED DEFECT: passes the engine's 429 through with its wait, so the sheet tells the visitor when to try again", async () => {
    const route = await loadRoute();
    engineStatus = 429;
    engineHeaders = { "Retry-After": "120" };
    const res = await post(route, valid());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
  });

  it("PLANTED INNOCENT: names no wait for an engine 429 that names none", async () => {
    const route = await loadRoute();
    engineStatus = 429;
    const res = await post(route, valid());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("does not blame the visitor for a key the engine does not let Guest set: the site is not set up for it", async () => {
    const route = await loadRoute();
    engineStatus = 400;
    engineBody = { error: { code: "BAD_REQUEST", field: "company" } };
    expect(await send(route, valid())).toEqual({ status: 503, body: { ok: false, message: "Contact is not configured" } });
  });

  it("answers 500 without an internal URL when the engine fails the create", async () => {
    const route = await loadRoute();
    engineStatus = 500;
    const answer = await send(route, valid());
    expect(answer.status).toBe(500);
    expect(JSON.stringify(answer.body)).not.toMatch(/internal/);
  });
});
