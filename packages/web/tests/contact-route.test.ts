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
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
};

type Answer = { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;
let engineStatus = 201;
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

async function send(route: Awaited<ReturnType<typeof loadRoute>>, body: unknown, from = `203.0.113.${++address}`): Promise<Answer> {
  const req = new NextRequest("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify(body),
  });
  const res = await route.POST(req);
  return { status: res.status, body: await res.json() };
}

const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));

beforeEach(() => {
  engineStatus = 201;
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/api/v1/public/resource/WebSite")) {
      return Response.json({ data: [{ _id: "simetrix", site_name: "simetrix", contact_email: "hello@example.org" }] });
    }
    if (url.includes("/api/v1/public/resource/ContactRequest")) return Response.json({ data: {} }, { status: engineStatus });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    expect(JSON.parse(create?.[1].body)).toEqual({ site: "simetrix", ...fields });
    expect(fetchMock.mock.calls.filter(([url]) => !String(url).includes("engine.internal"))).toHaveLength(0);
  });

  it("PLANTED DEFECT: a filled honeypot is answered like a success and reaches nothing", async () => {
    const route = await loadRoute();
    expect(await send(route, { ...valid(), website: "https://spam.example" })).toEqual({ status: 200, body: { ok: true } });
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("answers 429 to the sixth request in an hour from one address", async () => {
    const route = await loadRoute();
    for (let i = 0; i < 5; i++) expect((await send(route, valid(), "198.51.100.7")).status).toBe(200);
    expect((await send(route, valid(), "198.51.100.7")).status).toBe(429);
    expect((await send(route, valid(), "198.51.100.8")).status).toBe(200);
  });

  it("answers 500 without an internal URL when the engine fails the create", async () => {
    const route = await loadRoute();
    engineStatus = 500;
    const answer = await send(route, valid());
    expect(answer.status).toBe(500);
    expect(JSON.stringify(answer.body)).not.toMatch(/internal/);
  });
});
