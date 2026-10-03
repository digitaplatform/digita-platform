// @vitest-environment jsdom
// The family's item for the contact sheet, in the family menu and in the phone's menu drawer: it
// opens the sheet rather than linking to an anchor no page holds, and it closes the menu or the
// drawer it sits in, so the sheet is not opened behind it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfigProvider } from "../src/config/ConfigProvider";
import type { PublicSiteConfig } from "../src/config/public";
import { FamilySwitcher } from "../src/components/FamilySwitcher";
import { MobileNav } from "../src/components/MobileNav";
import { closeContactSheet, useContactSheetOpen } from "../src/lib/contact-sheet";
import type { NavItem } from "../src/lib/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {} }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const siteConfig: PublicSiteConfig = {
  siteId: "example",
  siteUrl: "https://example.org",
  publicEngineUrl: "",
  versionEndpoints: [],
  locales: ["en"],
  defaultLocale: "en",
  contactEnabled: true,
  notFound: { title: "", body: "", home: "" },
};

const family: NavItem[] = [
  { label: "sister", href: "https://sister.example.net" },
  { label: "Talk to us", href: "#contact" },
];

/** Whether the contact sheet is open, as the sheet itself reads it. */
let sheetOpen = false;
function SheetProbe() {
  sheetOpen = useContactSheetOpen();
  return null;
}

let root: Root | null = null;

afterEach(async () => {
  await act(async () => closeContactSheet());
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ConfigProvider value={siteConfig}>
        {element}
        <SheetProbe />
      </ConfigProvider>,
    ),
  );
}

const contactItem = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Talk to us");

describe("the family menu", () => {
  async function openMenu() {
    await render(<FamilySwitcher locale="en" items={family} label="Family" comingLabel="coming" />);
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Family"]')!.click());
  }

  it("shows the item for the contact sheet as its button, not as a link to #contact", async () => {
    await openMenu();
    expect(document.querySelector('a[href="#contact"]')).toBeNull();
    expect(contactItem()?.getAttribute("role")).toBe("menuitem");
  });

  it("PLANTED DEFECT: closes when its item opens the contact sheet", async () => {
    await openMenu();
    await act(async () => contactItem()!.click());
    expect(sheetOpen).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("PLANTED INNOCENT: stays open while no item is picked", async () => {
    await openMenu();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(sheetOpen).toBe(false);
  });
});

describe("the phone's menu drawer", () => {
  async function openDrawer() {
    await render(
      <MobileNav
        locale="en"
        items={[]}
        apps={[]}
        family={family}
        brand={{ name: "example" }}
        label="Navigation"
        navLabel="Primary"
        openLabel="Open menu"
        closeLabel="Close menu"
        comingLabel="coming"
      />,
    );
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]')!.click());
  }
  const drawerOpen = () => document.querySelector('button[aria-label="Open menu"]')!.getAttribute("aria-expanded") === "true";

  it("shows the family's item for the contact sheet as its button, not as a link to #contact", async () => {
    await openDrawer();
    expect(document.querySelector('a[href="#contact"]')).toBeNull();
    expect(contactItem()).toBeDefined();
  });

  it("PLANTED DEFECT: closes when the family's item opens the contact sheet", async () => {
    await openDrawer();
    await act(async () => contactItem()!.click());
    expect(sheetOpen).toBe(true);
    expect(drawerOpen()).toBe(false);
  });

  it("PLANTED INNOCENT: stays open while no item is picked", async () => {
    await openDrawer();
    expect(drawerOpen()).toBe(true);
    expect(sheetOpen).toBe(false);
  });
});
