// A page marked no_index stays out of the sitemap and out of the hreflang alternates of the pages
// that remain: the site must not send crawlers to a page it tells them not to index.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
});

const { default: sitemap } = await import("../src/app/sitemap");

afterEach(() => vi.unstubAllGlobals());

type Row = { _id: string; slug: string; locale: string; translation_group?: string; no_index?: boolean };

const row = (locale: string, slug: string, rest: Partial<Row> = {}): Row => ({ _id: `example::${locale}::${slug}`, slug, locale, ...rest });

/** Answers like the engine's public list, which returns only the fields the request names: a list
 *  that never asks for no_index gets rows that cannot say whether the page is hidden. */
function stubEngine(rows: Row[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const fields: string[] | undefined = JSON.parse(new URL(String(input)).searchParams.get("fields") ?? "null") ?? undefined;
      const project = (r: Row) => (fields ? Object.fromEntries(Object.entries(r).filter(([key]) => fields.includes(key))) : r);
      return Response.json({ data: rows.map(project), meta: { total_pages: 1 } });
    }),
  );
}

const urls = async () => (await sitemap()).map((entry) => entry.url);

describe("the sitemap of a site with a no_index page", () => {
  it("PLANTED DEFECT: lists only the page that is not marked no_index", async () => {
    stubEngine([row("en", "privacy"), row("en", "rules", { no_index: true })]);
    // A sitemap that lists every published row names /rules here; this goes red then.
    expect(await urls()).toEqual(["https://example.org/privacy"]);
  });

  it("PLANTED INNOCENT: keeps a page without no_index and a page that sets it to false", async () => {
    stubEngine([row("en", "privacy"), row("en", "imprint", { no_index: false })]);
    expect(await urls()).toEqual(["https://example.org/privacy", "https://example.org/imprint"]);
  });

  it("PLANTED DEFECT: names no no_index page in the hreflang alternates of the translation that remains", async () => {
    stubEngine([
      row("en", "rules", { translation_group: "rules", no_index: true }),
      row("de", "rules", { translation_group: "rules" }),
      row("en", "privacy", { translation_group: "privacy" }),
      row("de", "privacy", { translation_group: "privacy" }),
    ]);
    const entries = await sitemap();
    expect(entries.map((entry) => entry.url)).toEqual(["https://example.org/de/rules", "https://example.org/privacy", "https://example.org/de/privacy"]);
    const rules = entries.find((entry) => entry.url === "https://example.org/de/rules");
    expect(Object.values(rules?.alternates?.languages ?? {})).not.toContain("https://example.org/rules");
    // PLANTED INNOCENT: a translation group whose pages are all indexable still names every language.
    const privacy = entries.find((entry) => entry.url === "https://example.org/privacy");
    expect(privacy?.alternates?.languages).toMatchObject({ en: "https://example.org/privacy", de: "https://example.org/de/privacy" });
  });
});
