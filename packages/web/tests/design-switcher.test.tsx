// @vitest-environment jsdom
// The design band keeps focus on the button the visitor clicked while its design loads, and takes
// no second click until the first design arrived.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const loadDesignFromApps = vi.fn(() => new Promise<boolean>(() => {}));
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
  it("keeps the clicked button enabled and focused while its design loads, and ignores a second click", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(<DesignSwitcher apps={["crm"]} authUrl={null} authCookieSuffix={null} texts={{ notBundled: "not bundled", refused: "{design} refused" }} />),
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
});
