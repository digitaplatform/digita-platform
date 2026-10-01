// The form routes refuse a body over 32 kB with 413 before anything parses it. The engine takes
// 16 kB of a public create, so a post it would take always fits, while Next's own ceiling for a
// body that reaches a route is 10 MB.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  ENGINE_URLS: JSON.stringify({ workshop: "http://workshop.internal:3000" }),
  SITE_ID: "veloluck",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
});

const record = await import("../src/app/api/record/route");
const contact = await import("../src/app/api/contact/route");

const LIMIT = 32 * 1024;
let address = 0;

const fetchMock = vi.fn(async (url: string) =>
  url.includes("/WebSite")
    ? Response.json({ data: [{ _id: "veloluck", site_name: "Veloluck", contact_email: "hello@example.org" }] })
    : Response.json({ success: true, data: { _id: "x" } }, { status: 201 }),
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bookings = () => ({
  app: "workshop",
  entity: "Booking",
  values: { contact_name: "Ada Example", email: "ada@example.org" },
  website: "",
  rendered_at: Date.now() - 10_000,
});
const requests = () => ({
  name: "Ada Example",
  email: "ada@example.org",
  topic: "contact",
  message: "Hello.",
  locale: "en",
  page: "/en",
  website: "",
  rendered_at: Date.now() - 10_000,
});

const forms = [
  { name: "record route", route: record, path: "/api/record", form: bookings },
  { name: "contact route", route: contact, path: "/api/contact", form: requests },
];

/** `form` as JSON of exactly `bytes` bytes, padded by a key the routes ignore. */
function padded(form: object, bytes: number): string {
  const bare = JSON.stringify({ ...form, padding: "" }).length;
  return JSON.stringify({ ...form, padding: "x".repeat(bytes - bare) });
}

type Route = { POST: (req: NextRequest) => Promise<Response> };

const requestTo = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${++address}`, ...headers },
    body,
    duplex: "half",
  });

async function post(route: Route, path: string, body: BodyInit, headers: Record<string, string> = {}) {
  const res = await route.POST(requestTo(path, body, headers));
  return { status: res.status, body: await res.json() };
}

/** A body that arrives in 1 kB chunks and declares no length, as a chunked upload does, and how many it was asked for. */
function chunked(text: string): { body: ReadableStream<Uint8Array>; pulled: () => number } {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 1024));
      offset += 1024;
    },
  });
  return { body, pulled: () => pulls };
}

describe.each(forms)("the $name", ({ route, path, form }) => {
  it("PLANTED DEFECT: refuses a body over the limit with 413 before it parses it, valid JSON or not", async () => {
    expect(await post(route, path, padded(form(), LIMIT + 1))).toEqual({ status: 413, body: { ok: false, message: "Request too large" } });
    // A route that parsed first would answer 400 to text that is no JSON; this goes red then.
    expect((await post(route, path, "x".repeat(LIMIT + 1))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: refuses a declared length over the limit without reading a byte of the body", async () => {
    const { body, pulled } = chunked(padded(form(), 4096));
    const req = requestTo(path, body, { "content-length": String(LIMIT + 1) });
    // A stream pulls its first chunk on its own, a tick after the request is made and before the route runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = pulled();
    expect((await route.POST(req)).status).toBe(413);
    expect(pulled()).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PLANTED DEFECT: stops reading a chunked body at the limit instead of taking all of it", async () => {
    const { body, pulled } = chunked(padded(form(), 200 * 1024));
    expect((await post(route, path, body)).status).toBe(413);
    // The body is 200 chunks; a route that took it whole pulls them all.
    expect(pulled()).toBeLessThan(100);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PLANTED INNOCENT: takes a body of exactly the limit, whole or chunked, and an ordinary one", async () => {
    expect((await post(route, path, JSON.stringify(form()))).status).toBe(200);
    expect((await post(route, path, padded(form(), LIMIT))).status).toBe(200);
    expect((await post(route, path, chunked(padded(form(), LIMIT)).body)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });
});
