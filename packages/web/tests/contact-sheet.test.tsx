// @vitest-environment jsdom
// The contact sheet opens from the store, takes focus, closes on Escape and gives focus back, and
// shows the confirmation once the route accepted the request.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ContactSheet } from "../src/components/ContactSheet";
import { closeContactSheet, openContactSheet } from "../src/lib/contact-sheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function mount(bookingUrl?: string) {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ContactSheet locale="en" contactEmail="hello@example.org" bookingUrl={bookingUrl} privacyHref="/privacy" />));
  await act(async () => openContactSheet());
  return opener;
}

afterEach(async () => {
  await act(async () => closeContactSheet());
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the contact sheet", () => {
  it("takes focus on open, closes on Escape and gives focus back", async () => {
    const opener = await mount();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(document.querySelector('input[name="website"]')?.getAttribute("tabindex")).toBe("-1");
    expect(document.body.textContent).not.toContain("Book a 30-minute call");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("links the booking page only when the site has one", async () => {
    await mount("https://example.org/book");
    expect(document.querySelector('a[href="https://example.org/book"]')?.textContent).toContain("Book a 30-minute call");
  });

  it("shows the confirmation after the route accepted the request", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const fill = (name: string, value: string) => {
      (document.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
    };
    fill("name", "Ada Example");
    fill("email", "ada@example.org");
    fill("message", "We want to digitalize our order intake.");
    await act(async () => document.querySelector("form")!.requestSubmit());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/contact");
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ name: "Ada Example", topic: "contact", website: "", locale: "en" });
    expect(typeof sent.rendered_at).toBe("number");
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Thank you. We reply within one working day.");
  });
});
