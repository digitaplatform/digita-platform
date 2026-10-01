// @vitest-environment jsdom
// On phones and tablets the top bar carries what the desktop's carries: the language menu, the mode
// button and the links, each link shown as the icon its data names. jsdom evaluates no media query,
// so the test reads from the classes which elements a viewport shows, with Tailwind's breakpoints,
// which the site's config and the theme preset keep.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import defaultTheme from "tailwindcss/defaultTheme";
import preset from "@digitaplatform/theme/preset";
import { ConfigProvider } from "../src/config/ConfigProvider";
import type { PublicSiteConfig } from "../src/config/public";
import { Header } from "../src/components/Header";
import type { NavItem, WebSite } from "../src/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("../src/i18n/messages", () => ({ t: (key: string) => key }));
const browser = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => browser.pathname, useRouter: () => ({ push: () => {} }) }));

const screens: Record<"sm" | "md" | "lg" | "xl" | "2xl", string> = defaultTheme.screens;
const breakpoints: Record<string, string | undefined> = screens;

const DISPLAY = /^(block|inline-block|inline|flex|inline-flex|table|inline-table|flow-root|grid|inline-grid|contents|list-item|hidden)$/;

/** Whether `element` shows on a viewport `viewport` px wide: neither it nor an ancestor is
 *  `hidden` there. A wider breakpoint wins over a narrower one, and within one breakpoint `hidden`
 *  wins, as Tailwind orders its CSS. */
function shownAt(element: Element, viewport: number): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const applying: { from: number; hides: boolean }[] = [];
    for (const token of node.classList) {
      const variants = token.split(":");
      const utility = variants.pop()!;
      if (!DISPLAY.test(utility)) continue;
      if (variants.length > 1) throw new Error(`the rule reads at most one breakpoint per class: ${token}`);
      let from = 0;
      if (variants.length === 1) {
        const minWidth = breakpoints[variants[0]!];
        if (minWidth === undefined || !/^\d+px$/.test(minWidth)) throw new Error(`not a min-width breakpoint: ${token}`);
        from = parseInt(minWidth, 10);
      }
      if (viewport >= from) applying.push({ from, hides: utility === "hidden" });
    }
    applying.sort((a, b) => a.from - b.from || Number(a.hides) - Number(b.hides));
    if (applying.at(-1)?.hides) return false;
  }
  return true;
}

/** The elements matching `selector` that a viewport `viewport` px wide shows. */
const shown = (selector: string, viewport: number) => [...document.body.querySelectorAll(selector)].filter((element) => shownAt(element, viewport));

const siteConfig: PublicSiteConfig = {
  siteId: "example",
  siteUrl: "https://example.org",
  publicEngineUrl: "",
  locales: ["en", "de"],
  defaultLocale: "en",
  contactEnabled: false,
  notFound: { title: "", body: "", home: "" },
};
const site: WebSite = { _id: "example", site_name: "example", domain: "example.org" };

function drawHeader(items: NavItem[]) {
  document.body.innerHTML = renderToStaticMarkup(
    <ConfigProvider value={siteConfig}>
      <Header
        locale="en"
        defaultLocale="en"
        site={site}
        nav={{ _id: "header", site: "example", locale: "en", location: "header", items }}
        family={null}
        apps={[]}
        brand={{ name: "example" }}
        contactEnabled={false}
        publishedSlugs={{ en: [""], de: [""] }}
        enabledLocales={[]}
      />
    </ConfigProvider>,
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  browser.pathname = "/";
  vi.restoreAllMocks();
});

describe("the rule of what a viewport shows", () => {
  it("reads the breakpoints the site renders with: the theme preset sets none of its own", () => {
    expect(preset.theme).not.toHaveProperty("screens");
    expect(preset.theme.extend).not.toHaveProperty("screens");
  });

  it("finds a control that only md and wider show", () => {
    document.body.innerHTML = '<div class="hidden items-center md:flex"><button aria-label="language"></button></div>';
    expect(shown("button", 390)).toHaveLength(0);
    expect(shown("button", 768)).toHaveLength(1);
  });

  it("passes a control that every width shows", () => {
    document.body.innerHTML = '<div class="flex items-center"><button aria-label="language"></button></div>';
    expect(shown("button", 390)).toHaveLength(1);
  });
});

const ITEMS: NavItem[] = [
  { label: "About", href: "/about", order: 0, icon: "info" },
  { label: "Events", href: "/events", order: 1, icon: "calendar-days" },
];

describe("the top bar on phones and tablets", () => {
  for (const viewport of [390, 768]) {
    it(`shows the language menu and the mode button at ${viewport} px`, () => {
      drawHeader(ITEMS);
      expect(shown('button[aria-label="language"]', viewport)).toHaveLength(1);
      expect(shown('button[aria-label="toggleTheme"]', viewport)).toHaveLength(1);
    });

    it(`shows each link as the icon its data names at ${viewport} px`, () => {
      drawHeader(ITEMS);
      for (const [href, label, icon] of [
        ["/about", "About", "info"],
        ["/events", "Events", "calendar-days"],
      ]) {
        const links = shown(`a[href="${href}"]`, viewport);
        expect(links, href).toHaveLength(1);
        expect(links[0]!.getAttribute("aria-label")).toBe(label);
        expect(links[0]!.textContent).toBe("");
        expect(links[0]!.querySelector(`svg.lucide-${icon}`), href).not.toBeNull();
      }
    });
  }

  for (const viewport of [390, 768]) {
    it(`PLANTED DEFECT: marks the icon of the page the visitor is on as current at ${viewport} px`, () => {
      browser.pathname = "/events";
      drawHeader(ITEMS);
      const [events] = shown('a[href="/events"]', viewport);
      expect(events!.getAttribute("aria-current")).toBe("page");
      expect(events!.className).toContain("text-primary-600");
    });

    it(`PLANTED INNOCENT: leaves the icon of another page unmarked at ${viewport} px`, () => {
      browser.pathname = "/events";
      drawHeader(ITEMS);
      const [about] = shown('a[href="/about"]', viewport);
      expect(about!.hasAttribute("aria-current")).toBe(false);
      expect(about!.className).not.toContain("text-primary-600");
    });
  }

  it("keeps a link whose data names no icon as text on a tablet", () => {
    drawHeader([{ label: "Imprint", href: "/imprint", order: 0 }]);
    expect(shown('a[href="/imprint"]', 768).map((link) => link.textContent)).toEqual(["Imprint"]);
  });

  it("reports an icon lucide does not have and shows the link as text on a tablet", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    drawHeader([{ label: "About", href: "/about", order: 0, icon: "no-such-icon" }]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"no-such-icon"'));
    expect(shown('a[href="/about"]', 768).map((link) => link.textContent)).toEqual(["About"]);
  });
});

describe("the top bar from lg on", () => {
  it("shows each link as text, as before", () => {
    drawHeader(ITEMS);
    expect(shown('a[href="/about"]', 1024).map((link) => link.textContent)).toEqual(["About"]);
    expect(shown('a[href="/events"]', 1024).map((link) => link.textContent)).toEqual(["Events"]);
    expect(shown("a svg[class*=lucide-]", 1024)).toHaveLength(0);
  });
});
