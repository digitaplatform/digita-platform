// @vitest-environment jsdom
// A menu item with the href "#contact" stands for the contact sheet, in the footer and the family menu
// as in the header: no element of a page is the anchor's target, so as a link it would lead nowhere.
// Where the site offers the sheet the item opens it; where it does not, the item is left out.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfigProvider } from "../src/config/ConfigProvider";
import type { PublicSiteConfig } from "../src/config/public";
import { Footer } from "../src/components/Footer";
import { FamilySwitcher } from "../src/components/FamilySwitcher";
import { MobileNav } from "../src/components/MobileNav";
import { closeContactSheet, useContactSheetOpen } from "../src/lib/contact-sheet";
import type { NavItem, WebNavMenu, WebSite } from "../src/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("../src/i18n/messages", () => ({ t: (key: string) => key }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const siteConfig = (contactEnabled: boolean): PublicSiteConfig => ({
  siteId: "example",
  siteUrl: "https://example.org",
  publicEngineUrl: "",
  locales: ["en"],
  defaultLocale: "en",
  contactEnabled,
  notFound: { title: "", body: "", home: "" },
});

const footerNav: WebNavMenu = {
  _id: "footer",
  site: "example",
  locale: "en",
  location: "footer",
  items: [
    { label: "Privacy", href: "/privacy", order: 0 },
    { label: "Write to us", href: "#contact", order: 1 },
  ],
};

/** What the page's contact sheet reads: whether it is open. */
function SheetState() {
  return <output>{useContactSheetOpen() ? "open" : "closed"}</output>;
}

let root: Root | null = null;

async function drawFooter(site: WebSite, contactEnabled: boolean): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ConfigProvider value={siteConfig(contactEnabled)}>
        <Footer locale="en" site={site} nav={footerNav} brand={{ name: "example" }} contactEnabled={contactEnabled} />
        <SheetState />
      </ConfigProvider>,
    ),
  );
  return container;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  closeContactSheet();
});

describe("a #contact item of the footer menu", () => {
  it("opens the contact sheet where the site offers it", async () => {
    const footer = await drawFooter({ _id: "example", site_name: "example", contact_email: "hello@example.org" }, true);
    expect(footer.querySelector('a[href="#contact"]')).toBeNull();
    const item = [...footer.querySelectorAll("nav button")].find((button) => button.textContent === "Write to us");
    expect(item).toBeDefined();
    await act(async () => (item as HTMLButtonElement).click());
    expect(footer.querySelector("output")!.textContent).toBe("open");
  });

  it("is left out where the site offers no contact sheet", async () => {
    const footer = await drawFooter({ _id: "example", site_name: "example" }, false);
    expect(footer.textContent).not.toContain("Write to us");
    expect([...footer.querySelectorAll("nav li")].map((item) => item.textContent)).toEqual(["Privacy"]);
  });

  it("PLANTED DEFECT: follows the layout's rule for the sheet, not a rule of its own, and leaves no empty line", async () => {
    const footer = await drawFooter({ _id: "example", site_name: "example", contact_email: "hello@example.org" }, false);
    expect([...footer.querySelectorAll("nav li")].map((item) => item.textContent)).toEqual(["Privacy"]);
  });

  it("PLANTED INNOCENT: keeps the item where the layout offers the sheet", async () => {
    const footer = await drawFooter({ _id: "example", site_name: "example", contact_email: "hello@example.org" }, true);
    expect([...footer.querySelectorAll("nav li")].map((item) => item.textContent)).toEqual(["Privacy", "Write to us"]);
  });

  it("leaves the footer's other items links", async () => {
    const footer = await drawFooter({ _id: "example", site_name: "example", contact_email: "hello@example.org" }, true);
    expect(footer.querySelector('nav a[href="/privacy"]')!.textContent).toBe("Privacy");
  });
});

const family: NavItem[] = [
  { label: "Other site", href: "https://other.example.org", order: 0 },
  { label: "Write to us", href: "#contact", order: 1 },
];

/** Draws `menu` with the page's sheet state beside it, and opens it with the button `opener` names. */
async function drawOpened(menu: React.ReactElement, contactEnabled: boolean, opener: string): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ConfigProvider value={siteConfig(contactEnabled)}>
        {menu}
        <SheetState />
      </ConfigProvider>,
    ),
  );
  await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="${opener}"]`)!.click());
}

const familyMenus = [
  {
    name: "the family menu",
    draw: (contactEnabled: boolean) =>
      drawOpened(<FamilySwitcher locale="en" items={family} label="family" comingLabel="coming" />, contactEnabled, "family"),
    items: () => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')],
  },
  {
    name: "the family list of the phone menu",
    draw: (contactEnabled: boolean) =>
      drawOpened(
        <MobileNav locale="en" items={[]} apps={[]} family={family} brand={{ name: "example" }} label="menu" navLabel="nav" openLabel="open" closeLabel="close" comingLabel="coming" />,
        contactEnabled,
        "open",
      ),
    items: () => [...document.querySelectorAll('nav[aria-label="nav"] li')],
  },
];

describe.each(familyMenus)("a #contact item of $name", (menu) => {
  it("PLANTED DEFECT: opens the contact sheet where the site offers it", async () => {
    await menu.draw(true);
    expect(document.querySelector('a[href="#contact"]')).toBeNull();
    const item = menu.items().find((element) => element.textContent === "Write to us");
    const button = item?.closest("button") ?? item?.querySelector("button");
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(document.querySelector("output")!.textContent).toBe("open");
  });

  it("is left out where the site offers no contact sheet", async () => {
    await menu.draw(false);
    expect(menu.items().map((element) => element.textContent)).toEqual(["Other site"]);
  });

  it("PLANTED INNOCENT: leaves the family's other sites links", async () => {
    await menu.draw(true);
    expect(document.querySelector('a[href="https://other.example.org"]')!.textContent).toBe("Other site");
  });
});
