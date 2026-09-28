// @vitest-environment jsdom
// The chrome speaks the page's locale: no English literal is back in the chrome components, and a
// German site shows the German texts of TRANSLATIONS_DIR in the contact sheet and the status pills.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactSheet } from "../src/components/ContactSheet";
import { contactSheetTexts } from "../src/components/chrome-texts";
import { Stack } from "../src/blocks/marketing/Stack";
import { closeContactSheet, openContactSheet } from "../src/lib/contact-sheet";

vi.mock("server-only", () => ({}));
// The texts come from TRANSLATIONS_DIR as the pod reads them; the rest of the config is any value.
Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The chrome components that spoke English on every locale before their texts came from keys. */
const CHROME_FILES = [
  "components/ContactSheet.tsx",
  "components/FamilySwitcher.tsx",
  "components/NavItemLink.tsx",
  "components/DesignSwitcher.tsx",
  "components/Header.tsx",
  "blocks/marketing/shared.tsx",
];

/** The English literals removed, as they stood in the source. */
const REMOVED_LITERALS = [
  'label="Contact"',
  ">Contact</p>",
  'aria-label="Close"',
  "Thank you. We reply within one working day.",
  "Tell us in two sentences what you want to digitalize. We reply within one working day.",
  "Book a 30-minute call",
  "Sending failed. Please check your details and try again, or write to",
  "We use your details only to answer you.",
  'contact: "Contact", trial: "Trial", early_access: "Early access"',
  'label="Product family"',
  "· coming",
  "not bundled on this site",
  "design is not available to you here.",
  'available: "available", early_access: "early access", coming: "coming"',
];
/** The one-word labels and buttons removed, each on a JSX line of its own. */
const REMOVED_WORDS = ["Name", "Email", "Company", "Topic", "Message", "Send", "Privacy"];

describe("the chrome texts", () => {
  it("PLANTED DEFECT: no removed English literal is back in the chrome components", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const found: string[] = [];
    for (const file of CHROME_FILES) {
      const lines = readFileSync(join(src, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const literal of REMOVED_LITERALS) if (line.includes(literal)) found.push(`${file}:${i + 1} ${literal}`);
        if (REMOVED_WORDS.includes(line.trim())) found.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("PLANTED INNOCENT: the guard sees a literal that comes back", () => {
    expect(REMOVED_LITERALS.some((literal) => 'aria-label="Close"'.includes(literal))).toBe(true);
    expect(REMOVED_WORDS.includes("                Message".trim())).toBe(true);
  });
});

let root: Root | null = null;

afterEach(async () => {
  await act(async () => closeContactSheet());
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("a German site", () => {
  it("shows the contact sheet in German", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const sheet = createElement(ContactSheet, {
      locale: "de",
      texts: contactSheetTexts("de"),
      contactEmail: "hello@example.org",
      privacyHref: "/de/privacy",
      renderedAt: 1_000_000,
    });
    await act(async () => root!.render(sheet));
    await act(async () => openContactSheet());
    const text = document.body.textContent ?? "";
    expect(text).toContain("Nachricht");
    expect(document.querySelector('button[type="submit"]')?.textContent).toBe("Senden");
    expect(text).not.toContain("Message");
  });

  it("shows a status pill in German", () => {
    const html = renderToStaticMarkup(createElement(Stack, { props: { items: [{ title: "Shop", status: "coming" }] }, locale: "de" }));
    expect(html).toContain(">kommt<");
    expect(html).not.toContain(">coming<");
  });
});
