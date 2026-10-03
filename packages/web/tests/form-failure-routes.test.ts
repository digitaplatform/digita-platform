// The form routes say what a visitor can do about a failure: a 400 names the field to correct, and a
// 429 says in the standard header how many seconds to wait.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { TEST_FORM_KEY, signed } from "./signed-form";

vi.mock("server-only", () => ({}));

const ENV = {
  ENGINE_URL: "http://engine.internal:3000",
  VERSION_ENDPOINTS: "https://example.org/health",
  ENGINE_URLS: JSON.stringify({ workshop: "http://workshop.internal:3000" }),
  SITE_ID: "veloluck",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
  FORM_SIGNING_KEY: TEST_FORM_KEY,
};

type Route = { POST: (req: NextRequest) => Promise<Response> };
let engine: { status: number; body?: unknown; headers?: Record<string, string> };
let address = 0;

/** Fresh routes, so a budget spent in one test is not spent in the next. */
async function loadRoutes(): Promise<{ record: Route; contact: Route }> {
  Object.assign(process.env, ENV);
  vi.resetModules();
  return { record: await import("../src/app/api/record/route"), contact: await import("../src/app/api/contact/route") };
}

const booking = () =>
  signed({
    app: "workshop",
    entity: "Booking",
    values: { contact_name: "Ada Example", email: "ada@example.org" },
    website: "",
    rendered_at: Date.now() - 10_000,
  });
const contactRequest = () => ({
  name: "Ada Example",
  email: "ada@example.org",
  company: "",
  topic: "contact",
  message: "Hello.",
  locale: "en",
  page: "/en",
  website: "",
  rendered_at: Date.now() - 10_000,
});

async function send(route: Route, path: string, body: unknown, from = `203.0.113.${++address}`) {
  const res = await route.POST(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": from },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, retryAfter: res.headers.get("Retry-After") };
}

beforeEach(() => {
  engine = { status: 201 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/WebSite")
        ? Response.json({ data: [{ _id: "veloluck", site_name: "Veloluck", contact_email: "hello@example.org" }] })
        : Response.json(engine.body ?? { success: true, data: { _id: "x" } }, { status: engine.status, headers: engine.headers }),
    ),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/contact", () => {
  it("PLANTED DEFECT: names the field it refuses, the first one in the order of the form", async () => {
    const { contact } = await loadRoutes();
    const refused: [Record<string, unknown>, string][] = [
      [{ name: "Ada\r\nBcc: x@example.org" }, "name"],
      [{ email: "ada@example" }, "email"],
      [{ company: 5 }, "company"],
      [{ topic: "sales" }, "topic"],
      [{ message: "  " }, "message"],
      [{ name: "", email: "nope" }, "name"],
    ];
    for (const [change, field] of refused) {
      expect(await send(contact, "/api/contact", { ...contactRequest(), ...change }), JSON.stringify(change)).toMatchObject({ status: 400, body: { ok: false, field } });
    }
  });

  it("PLANTED INNOCENT: a request the route takes names no field", async () => {
    const { contact } = await loadRoutes();
    expect(await send(contact, "/api/contact", contactRequest())).toMatchObject({ status: 200, body: { ok: true } });
  });
});

describe("POST /api/record", () => {
  it("PLANTED DEFECT: names the value it refuses", async () => {
    const { record } = await loadRoutes();
    const tooLong = { ...booking(), values: { contact_name: "Ada", note: "x".repeat(5001) } };
    expect(await send(record, "/api/record", tooLong)).toMatchObject({ status: 400, body: { ok: false, field: "note" } });
  });

  it("PLANTED DEFECT: passes on the field the engine names in a 400, whether on the error or in its first message", async () => {
    const { record } = await loadRoutes();
    engine = { status: 400, body: { success: false, error: { code: "VALIDATION_ERROR", field: "email" } } };
    expect(await send(record, "/api/record", booking())).toMatchObject({ status: 400, body: { field: "email" } });
    engine = { status: 400, body: { success: false, error: { code: "VALIDATION_ERROR" }, messages: [{ text: "x" }, { path: "service_code" }, { path: "email" }] } };
    expect(await send(record, "/api/record", booking())).toMatchObject({ status: 400, body: { field: "service_code" } });
  });

  it("PLANTED INNOCENT: a 400 whose messages are no list still answers 400, without a field", async () => {
    const { record } = await loadRoutes();
    engine = { status: 400, body: { success: false, error: { code: "VALIDATION_ERROR" }, messages: "not a list" } };
    expect(await send(record, "/api/record", booking())).toMatchObject({ status: 400, body: { ok: false, message: "Invalid request" } });
  });

  it("PLANTED INNOCENT: a 400 in which the engine names no field names none", async () => {
    const { record } = await loadRoutes();
    engine = { status: 400, body: { success: false, error: { code: "VALIDATION_ERROR", detail: "2 validation error(s)" } } };
    const answer = await send(record, "/api/record", booking());
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ ok: false, message: "Invalid request" });
  });

  it("PLANTED DEFECT: passes on the wait the engine asks of a visitor over its own budget, and invents none when it asks for none", async () => {
    const { record } = await loadRoutes();
    engine = { status: 429, body: { success: false, error: { code: "RATE_LIMITED" } }, headers: { "retry-after": "30" } };
    expect(await send(record, "/api/record", booking())).toMatchObject({ status: 429, retryAfter: "30" });
    engine = { status: 429, body: { success: false, error: { code: "RATE_LIMITED" } } };
    expect(await send(record, "/api/record", booking())).toMatchObject({ status: 429, retryAfter: null });
  });
});

describe("the renderer's own budget of posts", () => {
  it("PLANTED DEFECT: answers 429 with the seconds after which the visitor is admitted again, not a second earlier or later", async () => {
    vi.useFakeTimers();
    const { contact, record } = await loadRoutes();
    for (let i = 0; i < 5; i++) expect((await send(contact, "/api/contact", contactRequest(), "198.51.100.7")).status).toBe(200);
    const refused = await send(contact, "/api/contact", contactRequest(), "198.51.100.7");
    expect(refused.status).toBe(429);
    const wait = Number(refused.retryAfter);
    expect(Number.isInteger(wait) && wait > 0).toBe(true);
    // The budget is shared by the routes, so the record route tells the same wait.
    expect(await send(record, "/api/record", booking(), "198.51.100.7")).toMatchObject({ status: 429, retryAfter: String(wait) });
    // The budget counts a refused post as well, so the wait runs from the last of them.
    vi.advanceTimersByTime(wait * 1000 - 1);
    expect((await send(contact, "/api/contact", contactRequest(), "198.51.100.7")).status).toBe(429);
    vi.advanceTimersByTime(1);
    expect((await send(contact, "/api/contact", contactRequest(), "198.51.100.7")).status).toBe(200);
  });

  it("PLANTED INNOCENT: an answer that is no 429 tells no wait", async () => {
    const { contact } = await loadRoutes();
    expect((await send(contact, "/api/contact", contactRequest())).retryAfter).toBeNull();
    expect((await send(contact, "/api/contact", { ...contactRequest(), email: "nope" })).retryAfter).toBeNull();
  });
});
