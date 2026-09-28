// The language menu offers, on one page, only the locales a visitor can land on.
import { describe, it, expect } from "vitest";
import { offeredLocales, preferredLocale } from "../src/config/locales";
import { pathSlug } from "../src/lib/nav";

const served = ["en", "de", "fr"];
// en publishes home and privacy, de publishes only the home, fr is all drafts.
const published = { en: ["", "privacy"], de: [""] };

describe("offeredLocales", () => {
  it("PLANTED DEFECT: on a page published in one locale only, no other locale is offered, even one whose home is published", () => {
    // A site-level rule (de has a published home) would offer Deutsch here and send the visitor to a 404.
    expect(offeredLocales(served, published, [], "privacy", "en")).toEqual(["en"]);
  });

  it("offers every locale in which the page is published, and keeps the current one", () => {
    expect(offeredLocales(served, published, [], "", "en")).toEqual(["en", "de"]);
    expect(offeredLocales(served, published, [], "", "de")).toEqual(["en", "de"]);
    // The way back stays even where the current locale's page is not published.
    expect(offeredLocales(served, published, [], "privacy", "de")).toEqual(["en", "de"]);
  });

  it("PLANTED INNOCENT: the site's enabled list narrows, an empty one does not, the current locale always stays", () => {
    expect(offeredLocales(served, { en: [""], de: [""], fr: [""] }, ["en", "fr"], "", "en")).toEqual(["en", "fr"]);
    expect(offeredLocales(served, { en: [""], de: [""], fr: [""] }, [], "", "en")).toEqual(["en", "de", "fr"]);
    expect(offeredLocales(served, { en: [""], de: [""], fr: [""] }, ["en"], "", "de")).toEqual(["en", "de"]);
  });
});

describe("pathSlug", () => {
  it("names the page without its locale prefix, and the home as an empty slug", () => {
    expect(pathSlug("/", served)).toBe("");
    expect(pathSlug("/de", served)).toBe("");
    expect(pathSlug("/de/", served)).toBe("");
    expect(pathSlug("/privacy", served)).toBe("privacy");
    expect(pathSlug("/de/privacy", served)).toBe("privacy");
    expect(pathSlug("/de/docs/start", served)).toBe("docs/start");
  });
});

describe("preferredLocale", () => {
  const offered = ["en", "de"];

  it("PLANTED DEFECT: a browser that prefers German, with a region, is sent to de", () => {
    expect(preferredLocale("de-CH,de;q=0.9,en;q=0.8", offered, "en")).toBe("de");
    // Reading the tag whole (de-CH is not an offered locale) would pick en here, and this goes red.
    expect(preferredLocale("de-CH,en;q=0.8", offered, "en")).toBe("de");
    // Reading the list in order, not by quality, would pick en here.
    expect(preferredLocale("en;q=0.5,de", offered, "en")).toBe("de");
    // Reading the parameter name case-sensitively would give en the quality 1 here.
    expect(preferredLocale("en;Q=0.1,de;q=0.5", offered, "en")).toBe("de");
  });

  it("PLANTED INNOCENT: a quality that is no number or zero drops the language, an empty entry names none", () => {
    expect(preferredLocale("de;q=abc", offered, "en")).toBeNull();
    expect(preferredLocale("de;q=0", offered, "en")).toBeNull();
    expect(preferredLocale(",de", offered, "en")).toBe("de");
  });

  it("PLANTED INNOCENT: a browser that prefers the default locale, or nothing the site offers, stays", () => {
    expect(preferredLocale("en-US,en;q=0.9,de;q=0.8", offered, "en")).toBeNull();
    expect(preferredLocale("fr-FR,fr;q=0.9", offered, "en")).toBeNull();
    expect(preferredLocale("*", offered, "en")).toBeNull();
    expect(preferredLocale("", offered, "en")).toBeNull();
  });
});
