// @vitest-environment jsdom
// The website's light/dark button keeps the visitor's pick where the app keeps it, in this browser
// and in the person's look cookie. The cookie is read first, so a pick kept only in the browser
// would be undone on the next page.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LOOK_COOKIE_NAME, MODE_STORAGE_KEY, readLookCookie, resolveInitialMode } from "@digitaplatform/theme";
import { ThemeToggle } from "../src/components/ThemeToggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.cookie = `${LOOK_COOKIE_NAME}=; Path=/; Max-Age=0`;
  localStorage.clear();
  vi.restoreAllMocks();
});

async function renderToggle(cookieDomain: string | undefined) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ThemeToggle label="Toggle theme" lookCookieDomain={cookieDomain} />));
  return container.querySelector("button")!;
}

describe("the website's light/dark button", () => {
  it("keeps the next mode in this browser and in the look cookie, so the next page shows it", async () => {
    localStorage.setItem(MODE_STORAGE_KEY, "dark");
    document.cookie = `${LOOK_COOKIE_NAME}=${encodeURIComponent("mode=dark")}; Path=/`;
    const button = await renderToggle(undefined);
    await act(async () => button.click());
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe("system");
    expect(readLookCookie().mode).toBe("system");
    expect(resolveInitialMode()).toBe("system");
  });

  it("writes the look cookie for the Domain it is given", async () => {
    const written: string[] = [];
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    vi.spyOn(Document.prototype, "cookie", "set").mockImplementation(function (this: Document, value: string) {
      written.push(value);
      cookie.set!.call(this, value);
    });
    const button = await renderToggle("acme.example");
    await act(async () => button.click());
    expect(written.filter((value) => value.startsWith(`${LOOK_COOKIE_NAME}=`))).toEqual([expect.stringContaining("; Domain=acme.example")]);
  });
});
