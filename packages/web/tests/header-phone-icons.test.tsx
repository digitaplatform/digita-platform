// @vitest-environment jsdom
// On phones and tablets the top bar carries what the desktop's carries: the language menu, the mode
// button and the links, each link shown as the icon its data names. jsdom evaluates no media query,
// so the test reads from the classes which elements a viewport shows, with Tailwind's breakpoints,
// which the site's config and the theme preset keep.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
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
        // An arbitrary breakpoint, as `min-[380px]:flex`, names its width itself.
        const minWidth = variants[0]!.match(/^min-\[(\d+px)\]$/)?.[1] ?? breakpoints[variants[0]!];
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

function drawHeader(items: NavItem[], config = siteConfig) {
  document.body.innerHTML = renderToStaticMarkup(
    <ConfigProvider value={config}>
      <Header
        locale="en"
        defaultLocale="en"
        site={site}
        nav={{ _id: "header", site: "example", locale: "en", location: "header", items }}
        family={null}
        apps={[]}
        brand={{ name: "example" }}
        publishedSlugs={{ en: [""], de: [""] }}
        enabledLocales={[]}
        lookCookieDomain={undefined}
        modeLocked={false}
        identity={{ apps: [], authUrl: null, authCookieSuffix: null }}
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

  it("finds a control that an arbitrary breakpoint shows", () => {
    document.body.innerHTML = '<div class="hidden min-[380px]:flex"><button aria-label="language"></button></div>';
    expect(shown("button", 379)).toHaveLength(0);
    expect(shown("button", 380)).toHaveLength(1);
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
  }

  for (const viewport of [430, 768]) {
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

  for (const viewport of [430, 768]) {
    it(`PLANTED DEFECT: marks the icon of the page the visitor is on as current at ${viewport} px`, () => {
      browser.pathname = "/events";
      drawHeader(ITEMS);
      const [events] = shown('a[href="/events"]', viewport);
      expect(events!.getAttribute("aria-current")).toBe("page");
      expect(events!.className).toContain("text-primaryText");
    });

    it(`PLANTED INNOCENT: leaves the icon of another page unmarked at ${viewport} px`, () => {
      browser.pathname = "/events";
      drawHeader(ITEMS);
      const [about] = shown('a[href="/about"]', viewport);
      expect(about!.hasAttribute("aria-current")).toBe(false);
      expect(about!.className).not.toContain("text-primaryText");
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

/**
 * What the phone's top bar takes, in px, as Chromium lays it out: the row's padding (px-4 on both
 * sides); the language menu, the mode button, the call to action measured with the label "Contact",
 * which is wider than the mail icon a phone shows, so the check errs on the safe side; the menu
 * button and the gap before them; the brand's mark with the first letters of its name; and
 * per icon link its button (p-1.5 around h-5) and the gap-1 before it, the first one the nav's
 * gap-6 instead.
 */
const BAR = { padding: 32, controls: 227, brand: 61, icon: 32, iconGap: 4, navGap: 24 };

/** The phone widths at which the bar, as drawn in the document, needs more room than the screen
 *  has: each shown icon link takes its share beside what every phone bar carries. */
function overflowingWidths(widths: number[]): number[] {
  return widths.filter((viewport) => {
    const icons = shown("nav a[aria-label]", viewport).length;
    const iconRow = icons ? BAR.navGap + icons * BAR.icon + (icons - 1) * BAR.iconGap : 0;
    return BAR.padding + BAR.controls + BAR.brand + iconRow > viewport;
  });
}

/** Every phone width, 320 px up to the tablet's 768. */
const PHONE_WIDTHS = Array.from({ length: 768 - 320 }, (_, i) => 320 + i);

const FIVE_ICONS: NavItem[] = [
  { label: "About", href: "/about", order: 0, icon: "info" },
  { label: "Events", href: "/events", order: 1, icon: "calendar-days" },
  { label: "Shop", href: "/shop", order: 2, icon: "shopping-cart" },
  { label: "Blog", href: "/blog", order: 3, icon: "newspaper" },
  { label: "Team", href: "/team", order: 4, icon: "users" },
  { label: "Contact", href: "#contact", order: 5 },
];

describe("the top bar's icon links on a phone", () => {
  it("fit beside the brand and the controls at every width from 320 px, with five icons and the call to action", () => {
    drawHeader(FIVE_ICONS);
    expect(overflowingWidths(PHONE_WIDTHS)).toEqual([]);
  });

  it("keep a long call to action as a mail icon below the tablet, named by its full label, and fit at every width", () => {
    const longLabel = "Kontakt aufnehmen";
    drawHeader(
      FIVE_ICONS.map((item) => (item.href === "#contact" ? { ...item, label: longLabel } : item)),
      { ...siteConfig, contactEnabled: true },
    );
    const cta = document.querySelector(`button[aria-label="${longLabel}"]`)!;
    expect(cta).not.toBeNull();
    expect(cta.getAttribute("title")).toBe(longLabel);
    // Below md the bar carries the mail icon, narrower than the "Contact" label the fit check counts.
    expect(shown(`button[aria-label="${longLabel}"] span`, 320)).toHaveLength(0);
    expect(shown(`button[aria-label="${longLabel}"] svg`, 320)).toHaveLength(1);
    expect(overflowingWidths(PHONE_WIDTHS)).toEqual([]);
    expect(shown(`button[aria-label="${longLabel}"] span`, 768).map((span) => span.textContent)).toEqual([longLabel]);
    expect(shown(`button[aria-label="${longLabel}"] svg`, 768)).toHaveLength(0);
  });

  it("show none at 320 px, where the menu holds them, and more as the screen widens", () => {
    drawHeader(FIVE_ICONS);
    expect(shown("nav a[aria-label]", 320)).toHaveLength(0);
    expect(shown("nav a[aria-label]", 390).map((link) => link.getAttribute("aria-label"))).toEqual(["About"]);
    expect(shown("nav a[aria-label]", 640)).toHaveLength(5);
  });

  it("show an icon link past the bar's room as text on a tablet, so no width loses it", () => {
    const six: NavItem[] = [...FIVE_ICONS, { label: "Jobs", href: "/jobs", order: 6, icon: "briefcase" }];
    drawHeader(six);
    expect(shown('a[href="/jobs"]', 640)).toHaveLength(0);
    expect(shown('a[href="/jobs"]', 768).map((link) => link.textContent)).toEqual(["Jobs"]);
  });

  it("PLANTED DEFECT: the fit check finds a bar that shows five icons at every width", () => {
    document.body.innerHTML = `<nav class="flex">${'<a aria-label="x" class="p-1.5"></a>'.repeat(5)}</nav>`;
    expect(overflowingWidths([320, 390, 460])).toEqual([320, 390, 460]);
  });

  it("PLANTED INNOCENT: the fit check passes a bar that shows one icon from 380 px", () => {
    document.body.innerHTML = '<nav class="flex"><a aria-label="x" class="hidden min-[380px]:flex"></a></nav>';
    expect(overflowingWidths([320, 379, 380, 390])).toEqual([]);
  });
});

describe("the phone's mode button", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  /** The header live in the document, with the phone's menu drawer opened. */
  async function openDrawer() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ConfigProvider value={siteConfig}>
          <Header
            locale="en"
            defaultLocale="en"
            site={site}
            nav={{ _id: "header", site: "example", locale: "en", location: "header", items: ITEMS }}
            family={null}
            apps={[]}
            brand={{ name: "example" }}
            publishedSlugs={{ en: [""], de: [""] }}
            enabledLocales={[]}
            lookCookieDomain={undefined}
            modeLocked={false}
        identity={{ apps: [], authUrl: null, authCookieSuffix: null }}
          />
        </ConfigProvider>,
      ),
    );
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="openMenu"]')!.click());
    return root;
  }

  it("PLANTED DEFECT: is one, and one language menu, with the menu drawer open: the bar shows both on a phone", async () => {
    const root = await openDrawer();
    expect(document.querySelector('[role="dialog"], [aria-modal="true"]')).not.toBeNull();
    expect(shown('button[aria-label="toggleTheme"]', 390)).toHaveLength(1);
    expect(shown('button[aria-label="language"]', 390)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("PLANTED INNOCENT: the drawer still holds the nav", async () => {
    const root = await openDrawer();
    expect(document.querySelector('[aria-modal="true"] nav[aria-label="navPrimary"], [role="dialog"] nav[aria-label="navPrimary"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});
