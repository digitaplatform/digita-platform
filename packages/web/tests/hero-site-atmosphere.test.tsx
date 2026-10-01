// @vitest-environment jsdom
// Every page of a site opens with a hero, but only rows that set their own atmosphere drew the rain.
// The site names its atmosphere and rain once; a hero without an atmosphere of its own takes the
// site's, and one that names its own keeps it. The page is rendered as the routes render it.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Block, WebPage, WebSite } from "../src/lib/types";
import { setSiteEnv } from "./site-env";

vi.mock("server-only", () => ({}));
setSiteEnv();

// The code-split plugin registry cannot be waited for in a static render, and no hero here draws a figure.
vi.mock("@/plugins", () => ({ PLUGIN_MANIFESTS: [], resolvePlugin: () => null }));

const { PageView } = await import("../src/components/PageView");

const rainySite: WebSite = {
  _id: "example",
  site_name: "Example",
  hero_atmosphere: "data-rain",
  hero_rain: [{ tokens: ["site-alpha", "site-beta"] }, { tokens: ["site-gamma"] }],
};
const plainSite: WebSite = { _id: "example", site_name: "Example" };

function page(hero: Record<string, unknown>): WebPage {
  const blocks: Block[] = [{ type: "hero_brand", props: { heading: "Welcome", ...hero } }];
  return { _id: "p", site: "example", locale: "en", slug: "about", title: "About", blocks };
}

/** The tokens of each falling column of the rendered page, or none when no rain is drawn. */
function rainColumns(site: WebSite | null, hero: Record<string, unknown>): string[][] {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<PageView page={page(hero)} site={site} />);
  const rain = host.querySelector("[data-block='hero_brand'] [aria-hidden='true']");
  return [...(rain?.children ?? [])].map((column) => [...new Set((column.textContent ?? "").split("\n"))]);
}

describe("a hero on a site that names its atmosphere", () => {
  it("draws the site's rain when the block names no atmosphere", () => {
    expect(rainColumns(rainySite, {})).toEqual([["site-alpha", "site-beta"], ["site-gamma"]]);
  });

  it("draws no rain when the block opts out with none", () => {
    expect(rainColumns(rainySite, { atmosphere: "none" })).toEqual([]);
  });

  it("draws the block's own rain, not the site's, when the block brings its own", () => {
    const own = { atmosphere: "data-rain", rain: [{ tokens: ["page-one"] }] };
    expect(rainColumns(rainySite, own)).toEqual([["page-one"]]);
  });

  it("draws no rain on a site without the fields when the block names no atmosphere", () => {
    expect(rainColumns(plainSite, {})).toEqual([]);
    expect(rainColumns(null, {})).toEqual([]);
  });
});
