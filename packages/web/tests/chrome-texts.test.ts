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
import { setSiteEnv } from "./site-env";

vi.mock("server-only", () => ({}));
setSiteEnv();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The chrome components that spoke English on every locale before their texts came from keys. */
const CHROME_FILES = [
  "components/ContactSheet.tsx",
  "components/FamilySwitcher.tsx",
  "components/NavItemLink.tsx",
  "components/DesignSwitcher.tsx",
  "components/Header.tsx",
  "components/MobileNav.tsx",
  "components/Footer.tsx",
  "blocks/components.tsx",
  "blocks/marketing/shared.tsx",
  "blocks/marketing/HeroBrand.tsx",
  "plugins/code-app/index.tsx",
];

/** The English literals removed, as they stood in the source. */
const REMOVED_LITERALS = [
  'label="Contact"',
  ">Contact</p>",
  'aria-label="Close"',
  "Let&apos;s talk.",
  "Thank you. We reply within one working day.",
  "Tell us in two sentences what you want to digitalize. We reply within one working day.",
  "Book a 30-minute call",
  "or write to us",
  'placeholder="Two sentences are enough."',
  "Sending failed. Please check your details and try again, or write to",
  "We use your details only to answer you.",
  'contact: "Contact", trial: "Trial", early_access: "Early access"',
  'label="Product family"',
  "· coming",
  "not bundled on this site",
  "design is not available to you here.",
  "This site runs on digita. Switch the design.",
  "One click restyles the whole site; the choice stays in your browser.",
  'available: "available", early_access: "early access", coming: "coming"',
  'aria-label="Primary"',
  'aria-label="Footer"',
  '"Embedded content"',
  "hover or tap to see the code",
  'aria-label="Show the code behind the form"',
];
/** The one-word labels and buttons removed, each on a JSX line of its own. */
const REMOVED_WORDS = ["Name", "Email", "Company", "Topic", "Message", "Send", "Privacy"];

/** Every line of `source` on which a removed literal stands, as `line-number literal`. */
function findReturnedLiterals(source: string): string[] {
  const found: string[] = [];
  source.split("\n").forEach((line, i) => {
    for (const literal of REMOVED_LITERALS) if (line.includes(literal)) found.push(`${i + 1} ${literal}`);
    if (REMOVED_WORDS.includes(line.trim())) found.push(`${i + 1} ${line.trim()}`);
  });
  return found;
}

describe("the chrome texts", () => {
  it("no removed English literal is back in the chrome components", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const found = CHROME_FILES.flatMap((file) => findReturnedLiterals(readFileSync(join(src, file), "utf8")).map((hit) => `${file}:${hit}`));
    expect(found).toEqual([]);
  });

  it("PLANTED DEFECT: a returned literal is found", () => {
    expect(findReturnedLiterals('<button aria-label="Close">\n                Message\n')).toEqual(['1 aria-label="Close"', "2 Message"]);
  });

  it("PLANTED INNOCENT: a line that reads its text from the texts prop is not found", () => {
    expect(findReturnedLiterals("              {texts.message}\n              <input name=\"message\" />")).toEqual([]);
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
    expect(document.querySelector("h2")?.textContent).toBe("Reden wir.");
    expect(document.querySelector("textarea")?.getAttribute("placeholder")).toBe("Zwei Sätze genügen.");
    expect(document.querySelector('button[type="submit"]')?.textContent).toBe("Senden");
    expect(text).not.toContain("Message");
  });

  it("shows a status pill in German", () => {
    const html = renderToStaticMarkup(createElement(Stack, { props: { items: [{ title: "Shop", status: "coming" }] }, locale: "de" }));
    expect(html).toContain(">kommt<");
    expect(html).not.toContain(">coming<");
  });
});
