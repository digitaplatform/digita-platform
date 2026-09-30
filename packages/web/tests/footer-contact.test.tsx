// @vitest-environment jsdom
// A menu item with the href "#contact" stands for the contact sheet, in the footer as in the header:
// no element of a page is the anchor's target, so as a link it would lead nowhere. Where the site
// offers the sheet the item opens it; where it does not, the item is left out.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfigProvider } from "../src/config/ConfigProvider";
import type { PublicSiteConfig } from "../src/config/public";
import { Footer } from "../src/components/Footer";
import { closeContactSheet, useContactSheetOpen } from "../src/lib/contact-sheet";
import type { WebNavMenu, WebSite } from "../src/lib/types";

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
        <Footer locale="en" site={site} nav={footerNav} brand={{ name: "example" }} />
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

  it("leaves the footer's other items links", async () => {
    const footer = await drawFooter({ _id: "example", site_name: "example", contact_email: "hello@example.org" }, true);
    expect(footer.querySelector('nav a[href="/privacy"]')!.textContent).toBe("Privacy");
  });
});
