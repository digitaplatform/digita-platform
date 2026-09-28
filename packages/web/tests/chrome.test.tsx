// @vitest-environment jsdom
// The site chrome: the family menu links each product by the rule its link sets, and the header
// turns the menu item "#contact" into the call to action.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigProvider } from "../src/config/ConfigProvider";
import type { PublicSiteConfig } from "../src/config/public";
import { FamilySwitcher } from "../src/components/FamilySwitcher";
import { Header } from "../src/components/Header";
import type { NavItem, WebSite } from "../src/lib/types";
import type { Locale } from "../src/i18n/config";
import { LocaleSwitcher } from "../src/components/LocaleSwitcher";
import LocaleNotFound from "../src/app/[locale]/not-found";

vi.mock("server-only", () => ({}));
vi.mock("../src/i18n/messages", () => ({ t: (key: string) => key }));
let currentPath = "/";
let currentLocale = "en";
vi.mock("next/navigation", () => ({ usePathname: () => currentPath, useRouter: () => ({ push: () => {} }), useParams: () => ({ locale: currentLocale }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const siteConfig = (contactEnabled: boolean): PublicSiteConfig => ({
  siteId: "example",
  siteUrl: "https://example.org",
  publicEngineUrl: "",
  locales: ["en", "de", "fr"],
  defaultLocale: "en",
  contactEnabled,
  notFound: { title: "Seite nicht gefunden", body: "Die gesuchte Seite gibt es nicht.", home: "Zur Startseite" },
});

const family: NavItem[] = [
  { label: "example", href: "https://example.org", order: 0 },
  { label: "sister", href: "https://sister.example.net", order: 1 },
  { label: "cloud", order: 2 },
];

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function openFamilyMenu() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ConfigProvider value={siteConfig(true)}>
        <FamilySwitcher locale="en" items={family} domain="example.org" label="familyLabel" comingLabel="coming" />
      </ConfigProvider>,
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  return document.querySelector('[role="menu"]')!;
}

describe("the family switcher", () => {
  it("opens another site of the family in a new tab, without handing it this page", async () => {
    const menu = await openFamilyMenu();
    const sister = [...menu.querySelectorAll("a")].find((a) => a.textContent === "sister");
    expect(sister?.getAttribute("href")).toBe("https://sister.example.net");
    expect(sister?.getAttribute("target")).toBe("_blank");
    expect(sister?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows a product without a link as coming, and links nowhere", async () => {
    const menu = await openFamilyMenu();
    const cloud = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.startsWith("cloud"));
    expect(cloud?.textContent).toBe("cloud · coming");
    expect(cloud?.tagName).toBe("SPAN");
    expect(cloud?.querySelector("a")).toBeNull();
  });

  it("marks the site the visitor is on, and does not link it", async () => {
    const menu = await openFamilyMenu();
    const current = menu.querySelector('[aria-current="true"]');
    expect(current?.textContent).toBe("example");
    expect(current?.tagName).toBe("SPAN");
    expect(menu.querySelectorAll("a")).toHaveLength(1);
  });
});

const site: WebSite = { _id: "example", site_name: "example", domain: "example.org", contact_email: "hello@example.org" };
const nav = {
  _id: "header",
  site: "example",
  locale: "en",
  location: "header" as const,
  items: [
    { label: "About", href: "/about", order: 0 },
    { label: "Book a call", href: "#contact", order: 1 },
  ],
};

const renderHeader = (contactEnabled: boolean, headerSite: WebSite = site, publishedSlugs: Record<string, string[]> = { en: [""], de: [""] }) =>
  renderToStaticMarkup(
    <ConfigProvider value={siteConfig(contactEnabled)}>
      <Header
        locale="de"
        defaultLocale="en"
        site={headerSite}
        nav={nav}
        family={null}
        apps={[]}
        brand={{ name: "example" }}
        contactEnabled={contactEnabled}
        publishedSlugs={publishedSlugs}
        enabledLocales={[]}
      />
    </ConfigProvider>,
  );

describe("the language menu", () => {
  const mountMenu = async (published: Record<string, string[]>, current: Locale) => {
    const container = document.createElement("div");
    document.body.append(container);
    const menuRoot = createRoot(container);
    await act(async () =>
      menuRoot.render(
        <ConfigProvider value={siteConfig(false)}>
          <LocaleSwitcher current={current} publishedSlugs={published} enabledLocales={[]} label="language" />
        </ConfigProvider>,
      ),
    );
    return { container, unmount: () => act(async () => menuRoot.unmount()) };
  };

  it("PLANTED DEFECT: on a page published in the current locale only, there is no menu, although the other locale's home is published", async () => {
    currentPath = "/privacy";
    const { container, unmount } = await mountMenu({ en: ["", "privacy"], de: [""] }, "en");
    // A menu here would offer Deutsch and send the visitor to /de/privacy, which does not exist.
    expect(container.querySelector('button[aria-label="language"]')).toBeNull();
    await unmount();
    container.remove();
  });

  it("offers the locales in which the page is published, and no draft locale", async () => {
    currentPath = "/";
    const { container, unmount } = await mountMenu({ en: [""], de: [""] }, "de");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="language"]')!.click());
    // The menu panel is portaled, so the body carries the items.
    const text = document.body.textContent ?? "";
    expect(text).toContain("English");
    expect(text).toContain("Deutsch");
    expect(text).not.toContain("Français");
    await unmount();
    container.remove();
    currentPath = "/";
  });

  it("remembers the visitor's pick in the locale cookie for a year, before it moves", async () => {
    currentPath = "/";
    const { container, unmount } = await mountMenu({ en: [""], de: [""] }, "en");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="language"]')!.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((el) => el.textContent === "Deutsch")!;
    // The document keeps only the cookie's name and value; the written string carries its lifetime and scope.
    let written = "";
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    Object.defineProperty(document, "cookie", { configurable: true, set: (value: string) => (written = value) });
    try {
      // PLANTED DEFECT: a switcher that only navigates sets no cookie, and a session cookie has no max-age; both go red.
      await act(async () => item.click());
      expect(written).toBe("locale=de; max-age=31536000; path=/; samesite=lax");
    } finally {
      Object.defineProperty(document, "cookie", cookie);
    }
    await unmount();
    container.remove();
  });

  it("PLANTED INNOCENT: the header shows the menu on a home page published in two locales", () => {
    expect(renderHeader(false, site, { en: [""], de: [""] })).toContain('aria-label="language"');
    // The header renders the de home; with only de published there is nowhere to switch to.
    expect(renderHeader(false, site, { de: [""] })).not.toContain('aria-label="language"');
  });
});

describe("the header", () => {
  it("renders the menu item #contact as the button that opens the contact sheet", () => {
    const html = renderHeader(true);
    expect(html).toMatch(/<button type="button"[^>]*data-variant="primary"[^>]*>Book a call<\/button>/);
    expect(html).not.toContain('href="#contact"');
    expect(html).toContain('href="/de/about"');
  });

  it("mails the site's address when the site offers no contact sheet", () => {
    const html = renderHeader(false);
    expect(html).toMatch(/<a href="mailto:hello@example.org"[^>]*>Book a call<\/a>/);
    expect(html).not.toMatch(/<button[^>]*>Book a call/);
  });

  it("PLANTED INNOCENT: offers no call to action that leads nowhere", () => {
    const html = renderHeader(false, { ...site, contact_email: undefined });
    expect(html).not.toContain("Book a call");
  });
});

describe("the locale's not-found page", () => {
  it("PLANTED DEFECT: reads its texts from the layout's config and links the locale's home, not English literals", () => {
    currentLocale = "de";
    const html = renderToStaticMarkup(
      <ConfigProvider value={siteConfig(false)}>
        <LocaleNotFound />
      </ConfigProvider>,
    );
    // The old page said "Page not found" and linked "/"; this goes red then.
    expect(html).toContain("Seite nicht gefunden");
    expect(html).toContain("Zur Startseite");
    expect(html).not.toContain("Page not found");
    expect(html).toContain('href="/de"');
    currentLocale = "en";
  });
});
