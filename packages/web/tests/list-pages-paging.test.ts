// A site with more published pages than one engine page holds lists all of them.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de,fr",
  DEFAULT_LOCALE: "en",
});

const { listPublishedSlugs } = await import("../src/lib/engine-client");
const { default: sitemap } = await import("../src/app/sitemap");

afterEach(() => vi.unstubAllGlobals());

/** Answers like the engine's public list: page_size is clamped to `ceiling`, page slices the rows and
 *  meta.total_pages counts the pages. Unless the request orders by `_id`, the rows tie on `modified`, and
 *  tied rows come back in another order on every request, because Mongo gives them no stable order. */
function stubEngine(count: number, ceiling = 200) {
  const rows = Array.from({ length: count }, (_, i) => {
    const slug = `page-${String(i).padStart(3, "0")}`;
    return { _id: `example::en::${slug}`, slug, locale: "en" };
  });
  let requests = 0;
  const fetch = vi.fn(async (input: string | URL) => {
    const params = new URL(String(input)).searchParams;
    const size = Math.min(Number(params.get("page_size")), ceiling);
    const page = Number(params.get("page") ?? "1");
    const shift = ++requests * 7;
    const ordered =
      params.get("order_by") === "_id asc"
        ? [...rows].sort((a, b) => a._id.localeCompare(b._id))
        : [...rows.slice(shift % count), ...rows.slice(0, shift % count)];
    return Response.json({
      data: ordered.slice((page - 1) * size, page * size),
      meta: { total_pages: Math.ceil(count / size) },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { rows, fetch };
}

describe("listPages paging", () => {
  it("PLANTED DEFECT: lists all 250 published pages in the sitemap, reading two engine pages", async () => {
    const { fetch } = stubEngine(250);
    const entries = await sitemap();
    expect(entries).toHaveLength(250);
    expect(entries.map((e) => e.url)).toContain("https://example.org/page-249");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("PLANTED DEFECT: lists each of 250 published slugs once for the language menu", async () => {
    const { rows, fetch } = stubEngine(250);
    expect(await listPublishedSlugs()).toEqual({ en: rows.map((r) => r.slug) });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("PLANTED DEFECT: lists every page when the engine clamps a page to fewer rows than it asked for", async () => {
    const { fetch } = stubEngine(250, 100);
    expect((await sitemap()).length).toBe(250);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("PLANTED INNOCENT: reads one engine page for a site with 3 pages", async () => {
    const { fetch } = stubEngine(3);
    expect((await sitemap()).length).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
