// @vitest-environment jsdom
// A site names its hero atmosphere and rain once; a hero without an atmosphere of its own takes the
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
  it("PLANTED DEFECT: a hero without an atmosphere of its own draws the site's rain", () => {
    expect(rainColumns(rainySite, {})).toEqual([["site-alpha", "site-beta"], ["site-gamma"]]);
  });

  it("PLANTED DEFECT: a hero whose atmosphere is empty takes the site's, as one without the key does", () => {
    expect(rainColumns(rainySite, { atmosphere: "" })).toEqual([["site-alpha", "site-beta"], ["site-gamma"]]);
  });

  it("PLANTED DEFECT: a site that names none draws no rain, though it carries columns", () => {
    expect(rainColumns({ ...rainySite, hero_atmosphere: "none" }, {})).toEqual([]);
  });

  it.each([
    ["no columns", undefined],
    ["null", null],
    ["a string", "site-alpha"],
    ["an object", { tokens: ["site-alpha"] }],
    ["columns without usable tokens", [{}, { tokens: 5 }, "site-alpha"]],
  ])("PLANTED DEFECT: a site with data-rain and %s as its columns draws no rain and does not throw", (_shape, unusable) => {
    expect(rainColumns({ ...rainySite, hero_rain: unusable }, {})).toEqual([]);
  });

  it("PLANTED DEFECT: a site that carries columns but names no atmosphere draws no rain", () => {
    expect(rainColumns({ ...plainSite, hero_rain: rainySite.hero_rain }, {})).toEqual([]);
  });

  it("PLANTED INNOCENT: a hero that opts out with none draws no rain", () => {
    expect(rainColumns(rainySite, { atmosphere: "none" })).toEqual([]);
  });

  it("PLANTED INNOCENT: a hero with its own rain draws its own columns, not the site's", () => {
    const own = { atmosphere: "data-rain", rain: [{ tokens: ["page-one"] }] };
    expect(rainColumns(rainySite, own)).toEqual([["page-one"]]);
  });

  it("PLANTED INNOCENT: a hero that brings rain but no atmosphere takes the site's rain whole", () => {
    expect(rainColumns(rainySite, { rain: [{ tokens: ["page-one"] }] })).toEqual([["site-alpha", "site-beta"], ["site-gamma"]]);
  });

  it("PLANTED INNOCENT: a hero that names data-rain without columns draws none, and borrows none of the site's", () => {
    expect(rainColumns(rainySite, { atmosphere: "data-rain" })).toEqual([]);
  });

  it("PLANTED INNOCENT: a site without the fields, or no site row, draws no rain", () => {
    expect(rainColumns(plainSite, {})).toEqual([]);
    expect(rainColumns(null, {})).toEqual([]);
  });
});
