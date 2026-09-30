// A page names one set of hreflang alternates: the page head and the sitemap entry of the same
// page carry it alike, x-default included, so a crawler never reads two sets for one URL.
import { describe, it, expect, afterEach, vi } from "vitest";
import type { WebPage } from "../src/lib/types";

vi.mock("server-only", () => ({}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de,fr",
  DEFAULT_LOCALE: "en",
});

const { default: sitemap } = await import("../src/app/sitemap");
const { buildPageMetadata } = await import("../src/lib/seo");

afterEach(() => vi.unstubAllGlobals());

const row = (locale: string, slug: string, rest: Partial<WebPage> = {}): WebPage =>
  ({ _id: `example::${locale}::${slug}`, site: "example", slug, locale, title: slug, status: "published", ...rest }) as WebPage;

const urlOf = (page: WebPage) => `https://example.org${page.locale === "en" ? "" : `/${page.locale}`}/${page.slug}`;

/** The published pages of a lending library's site: `join` in English and German, `rules` in both
 *  with the English one marked no_index, `imprint` in English alone, `nur-deutsch` in German alone,
 *  and `contact` in German and French, which leaves out the default locale. */
const join = { en: row("en", "join", { translation_group: "join" }), de: row("de", "join", { translation_group: "join" }) };
const rules = { en: row("en", "rules", { translation_group: "rules", no_index: true }), de: row("de", "rules", { translation_group: "rules" }) };
const imprint = row("en", "imprint");
const germanOnly = row("de", "nur-deutsch");
const contact = { de: row("de", "kontakt", { translation_group: "contact" }), fr: row("fr", "contact", { translation_group: "contact" }) };
const published = [join.en, join.de, rules.en, rules.de, imprint, germanOnly, contact.de, contact.fr];

/** Answers like the engine's public list, which returns only the fields the request names. */
function stubEngine(rows: WebPage[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const fields: string[] | undefined = JSON.parse(new URL(String(input)).searchParams.get("fields") ?? "null") ?? undefined;
      const project = (r: WebPage) => (fields ? Object.fromEntries(Object.entries(r).filter(([key]) => fields.includes(key))) : r);
      return Response.json({ data: rows.map(project), meta: { total_pages: 1 } });
    }),
  );
}

/** The alternates the page head names for `page`, and the ones its sitemap entry names. */
async function alternatesOf(page: WebPage) {
  const head = (await buildPageMetadata(page, null)).alternates?.languages;
  const entry = (await sitemap()).find((candidate) => candidate.url === urlOf(page));
  return { head, entry: entry?.alternates?.languages };
}

describe("the hreflang alternates of a page", () => {
  it("PLANTED DEFECT: are the same set in the sitemap entry as in the page head, x-default included", async () => {
    stubEngine(published);
    const { head, entry } = await alternatesOf(join.en);
    expect(head).toEqual({ en: "https://example.org/join", de: "https://example.org/de/join", "x-default": "https://example.org/join" });
    // A sitemap built from the translation group alone leaves x-default out; this goes red then.
    expect(entry).toEqual(head);
  });

  it("PLANTED DEFECT: agree for every page the sitemap lists, whatever its group holds", async () => {
    stubEngine(published);
    const listed = published.filter((page) => !page.no_index);
    expect(await sitemap()).toHaveLength(listed.length);
    for (const page of listed) {
      const { head, entry } = await alternatesOf(page);
      expect(entry, page._id).toEqual(head);
    }
  });

  it("PLANTED DEFECT: name a page alone in its language by itself, and x-default only when it is the default locale's", async () => {
    stubEngine(published);
    expect((await alternatesOf(imprint)).entry).toEqual({ en: "https://example.org/imprint", "x-default": "https://example.org/imprint" });
    expect((await alternatesOf(germanOnly)).entry).toEqual({ de: "https://example.org/de/nur-deutsch" });
  });

  it("PLANTED DEFECT: name no no_index translation, nor an x-default that would point at one, in the head or the sitemap", async () => {
    stubEngine(published);
    const { head, entry } = await alternatesOf(rules.de);
    expect(head).toEqual({ de: "https://example.org/de/rules" });
    expect(entry).toEqual(head);
  });

  it("PLANTED INNOCENT: a group without a page in the default locale names its languages and no x-default, in both", async () => {
    stubEngine(published);
    const { head, entry } = await alternatesOf(contact.de);
    expect(head).toEqual({ de: "https://example.org/de/kontakt", fr: "https://example.org/fr/contact" });
    expect(entry).toEqual(head);
  });
});
