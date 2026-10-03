// @vitest-environment jsdom
// A site's menu is one tree for all languages: each node links the page of its translation group in
// the visitor's language, is left out where no such page is published, and a node with children is
// a heading over them.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigProvider } from "../src/config/ConfigProvider";
import type { PublicSiteConfig } from "../src/config/public";
import { Footer } from "../src/components/Footer";
import { Header } from "../src/components/Header";
import { buildNavTree } from "../src/lib/nav";
import type { WebNavMenu, WebPage } from "../src/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("../src/i18n/messages", () => ({ t: (key: string) => key }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {} }), useParams: () => ({ locale: "en" }) }));

const siteConfig: PublicSiteConfig = {
  siteId: "example",
  siteUrl: "https://example.org",
  publicEngineUrl: "",
  versionEndpoints: [],
  locales: ["en", "de"],
  defaultLocale: "en",
  contactEnabled: true,
  notFound: { title: "", body: "", home: "" },
};

const node = (n: Partial<WebNavMenu> & Pick<WebNavMenu, "_id" | "label">): WebNavMenu => ({ site: "example", location: "footer", parent: null, ...n });

const pages: Pick<WebPage, "_id" | "locale" | "translation_group">[] = [
  { _id: "example::en::about", locale: "en", translation_group: "about" },
  { _id: "example::de::ueber-uns", locale: "de", translation_group: "about" },
  { _id: "example::en::privacy", locale: "en", translation_group: "privacy" },
];

const tree: WebNavMenu[] = [
  node({ _id: "company", label: "Company", position: 1 }),
  node({ _id: "about", label: "About", parent: "company", page: "example::en::about" }),
  node({ _id: "privacy", label: "Privacy", parent: "company", page: "example::en::privacy", position: 2 }),
  node({ _id: "contact", label: "Write to us", href: "#contact", position: 2 }),
  node({ _id: "demo", label: "Live demo", href: "https://show.example.org/workshop/", position: 3 }),
  node({ _id: "cloud", label: "Cloud", position: 4 }),
];

const footer = (locale: "en" | "de") =>
  renderToStaticMarkup(
    <ConfigProvider value={siteConfig}>
      <Footer locale={locale} site={null} nav={buildNavTree(tree, pages, locale)} brand={{ name: "example" }} contactEnabled />
    </ConfigProvider>,
  );

describe("a site's menu tree", () => {
  it("builds children under their parent, siblings by position and then label", () => {
    expect(buildNavTree(tree, pages, "en").map((item) => item.label)).toEqual(["Company", "Write to us", "Live demo", "Cloud"]);
    expect(buildNavTree(tree, pages, "en")[0]?.children?.map((item) => item.label)).toEqual(["About", "Privacy"]);
  });

  it("links the page of the node's translation group in each language", () => {
    expect(footer("en")).toContain('href="/about"');
    expect(footer("de")).toContain('href="/de/ueber-uns"');
  });

  it("draws a node whose page is published in English only in English, not in German", () => {
    expect(footer("en")).toContain(">Privacy<");
    expect(footer("de")).not.toContain("Privacy");
  });

  it("leaves out a heading whose children are all left out, and the subtree of an inactive node", () => {
    const onlyEnglish = [node({ _id: "legal", label: "Legal" }), node({ _id: "privacy", label: "Privacy", parent: "legal", page: "example::en::privacy" })];
    expect(buildNavTree(onlyEnglish, pages, "de")).toEqual([]);
    // The read leaves out inactive nodes, so a child's parent is missing.
    expect(buildNavTree([node({ _id: "orphan", label: "Orphan", parent: "inactive", href: "/x" })], pages, "en")).toEqual([]);
  });

  it.each(["parent", "label"] as const)("omits a node with masked %s and its descendants while keeping readable roots", (field) => {
    const masked = node({ _id: "masked", label: "Masked", href: "/hidden" });
    delete (masked as Partial<WebNavMenu>)[field];
    const descendant = node({ _id: "descendant", label: "Hidden child", parent: "masked", href: "/hidden-child" });
    const readable = node({ _id: "readable", label: "Readable", href: "/ok" });
    expect(buildNavTree([masked, descendant, readable], [], "en")).toEqual([{ label: "Readable", href: "/ok" }]);
  });

  it("prunes a known heading whose only child's label was masked", () => {
    const child = node({ _id: "child", label: "Hidden", parent: "heading", href: "/hidden" });
    delete (child as Partial<WebNavMenu>).label;
    expect(buildNavTree([
      node({ _id: "heading", label: "Heading" }), child,
      node({ _id: "readable", label: "Readable", href: "/ok" }),
    ], [], "en")).toEqual([{ label: "Readable", href: "/ok" }]);
  });

  it("draws a node with children as a heading, and keeps the rules of #contact, a web link and a node with no link", () => {
    const html = footer("en");
    expect(html).toMatch(/<li[^>]*>Company<\/li>/);
    expect(html).toContain(">Write to us</button>");
    expect(html).toMatch(/href="https:\/\/show.example.org\/workshop\/" target="_blank"/);
    expect(html).toContain("Cloud <span");
  });

  it.each(["root", "nested"])("puts a heading into a dropdown and the %s #contact node into the header button", (placement) => {
    const nav = buildNavTree(tree.map((n) => ({
      ...n, location: "header", ...(n._id === "contact" && placement === "nested" ? { parent: "company" } : {}),
    })), pages, "en");
    const html = renderToStaticMarkup(
      <ConfigProvider value={siteConfig}>
        <Header
          locale="en"
          defaultLocale="en"
          site={null}
          nav={nav}
          family={[]}
          apps={[]}
          brand={{ name: "example" }}
          publishedSlugs={{ en: [""] }}
          enabledLocales={[]}
          lookCookieDomain={undefined}
          modeLocked
          identity={{ apps: [], authUrl: null, authCookieSuffix: null }}
        />
      </ConfigProvider>,
    );
    expect(html).toMatch(/aria-haspopup="menu"[^>]*>Company/);
    expect(html).toMatch(/aria-label="Write to us"/);
  });

  it("removes empty nested footer headings when the contact sheet is unavailable", () => {
    const html = renderToStaticMarkup(
      <ConfigProvider value={{ ...siteConfig, contactEnabled: false }}>
        <Footer locale="en" site={null} brand={{ name: "example" }} contactEnabled={false} nav={[
          { label: "Contact heading", children: [{ label: "Nested heading", children: [{ label: "Contact leaf", href: "#contact" }] }] },
          { label: "Privacy", href: "/privacy" },
        ]} />
      </ConfigProvider>,
    );
    expect(html).not.toContain("Contact heading");
    expect(html).not.toContain("Nested heading");
    expect(html).not.toContain("Contact leaf");
    expect(html).toContain('href="/privacy"');
  });
});
