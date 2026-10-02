// @vitest-environment jsdom
// The design band keeps focus on the button the visitor clicked while its design loads, takes no
// second click until the first design arrived, and names a refused design in the site's own text.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { designSwitcherTexts } from "../src/components/chrome-texts";
import { setSiteEnv } from "./site-env";
import { DESIGN_STORAGE_KEY, LOOK_COOKIE_NAME, readLookCookie } from "@digitaplatform/theme";

vi.mock("server-only", () => ({}));
setSiteEnv();
const loadDesignFromApps = vi.fn((): Promise<boolean> => new Promise(() => {}));
vi.mock("../src/lib/delivered-identity", () => ({ loadDesignFromApps }));

const { DesignSwitcher } = await import("../src/components/DesignSwitcher");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("the design switcher", () => {
  it("keeps the picked design in this browser and in the person's look cookie, which every page reads", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(<DesignSwitcher apps={["crm"]} authUrl={null} authCookieSuffix={null} texts={designSwitcherTexts("en")} />),
    );
    const minimal = [...container.querySelectorAll("button")].find((b) => b.textContent === "minimal")!;
    await act(async () => minimal.click());
    expect(localStorage.getItem(DESIGN_STORAGE_KEY)).toBe("minimal");
    expect(readLookCookie().design).toBe("minimal");
    document.cookie = `${LOOK_COOKIE_NAME}=; Path=/; Max-Age=0`;
    localStorage.clear();
  });

  it("keeps the clicked button enabled and focused while its design loads, and ignores a second click", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(<DesignSwitcher apps={["crm"]} authUrl={null} authCookieSuffix={null} texts={designSwitcherTexts("en")} />),
    );
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "editorial")!;

    button.focus();
    await act(async () => button.click());
    // PLANTED DEFECT: a button disabled while it loads drops the focus to the body, and this goes red.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(button);

    await act(async () => button.click());
    expect(loadDesignFromApps).toHaveBeenCalledTimes(1);
  });

  it("names a refused design in the status line, filled into the text of TRANSLATIONS_DIR", async () => {
    loadDesignFromApps.mockResolvedValueOnce(false);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<DesignSwitcher apps={["crm"]} authUrl={null} authCookieSuffix={null} texts={designSwitcherTexts("en")} />));
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "editorial")!;
    await act(async () => button.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("The editorial design is not available to you here.");
  });
});
