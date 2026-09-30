// @vitest-environment jsdom
// The figure of a hero is a plugin: the hero hands it the block's props and the page's locale, the
// brand mark draws the monogram of the site's own signature, and the code app draws the texts of
// its seed row.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { registerSignature } from "@digitaplatform/theme";
import type { P } from "../src/blocks/marketing/shared";
import { setSiteEnv } from "./site-env";

vi.mock("server-only", () => ({}));
setSiteEnv();

const site = vi.hoisted(() => ({ theme: "simetrix" as string | undefined }));
vi.mock("@/lib/engine-client", () => ({ getSite: async () => ({ _id: "example", theme: site.theme }) }));

// A plugin that shows what it was handed, in place of the code-split registry a static render cannot wait for.
vi.mock("@/plugins", () => {
  const Probe = ({ props, locale }: { props?: P; locale: string }) => <p>{`probe ${String(props?.form_title)} ${locale}`}</p>;
  // A plugin that draws nothing, as the code app does without its definition.
  const Blank = () => null;
  return { PLUGIN_MANIFESTS: [], resolvePlugin: (id?: string) => ({ probe: Probe, blank: Blank })[id ?? ""] ?? null };
});

const { HeroBrand } = await import("../src/blocks/marketing/HeroBrand");
const { Showcase } = await import("../src/blocks/marketing/Showcase");
const { PluginBlock } = await import("../src/blocks/PluginBlock");
const { default: BrandMark } = await import("../src/plugins/brand-mark");
const { default: CodeApp } = await import("../src/plugins/code-app");
const { siteSignature } = await import("../src/lib/identity");

describe("a hero's figure", () => {
  it("gets the block's props and the page's locale, in a hero, a showcase and a plugin block", () => {
    expect(renderToStaticMarkup(<HeroBrand props={{ heading: "H", visual: "probe", form_title: "Order" }} locale="de" />)).toContain("probe Order de");
    expect(renderToStaticMarkup(<Showcase props={{ plugin_id: "probe", form_title: "Order" }} locale="de" />)).toContain("probe Order de");
    expect(renderToStaticMarkup(<PluginBlock props={{ plugin_id: "probe", form_title: "Order" }} locale="de" />)).toContain("probe Order de");
  });

  it("opens a column beside the text only when the plugin draws a figure", () => {
    const layout = (visual: string) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<HeroBrand props={{ heading: "H", visual }} locale="en" />);
      return host.querySelector("h1")!.parentElement!.parentElement!;
    };
    // PLANTED DEFECT: a plugin that draws nothing leaves the text at its reading width, as `none` does.
    expect(layout("blank").outerHTML).toBe(layout("none").outerHTML);
    expect(layout("blank").matches(":has(> :nth-child(2))")).toBe(false);
    // PLANTED INNOCENT: a drawn figure is the second child, and the two columns open on it alone.
    expect(layout("probe").matches(":has(> :nth-child(2))")).toBe(true);
    expect([...layout("probe").classList].filter((name) => name.includes("grid-cols"))).toEqual(["md:has-[>:nth-child(2)]:grid-cols-2"]);
  });
});

describe("the brand-mark plugin", () => {
  beforeEach(() => {
    site.theme = "simetrix";
  });

  it("draws the monogram of the site's signature with its aura and nodes", async () => {
    const html = renderToStaticMarkup(await BrandMark());
    expect(html).toContain("mark-aura");
    expect(html).toContain("mark-node");
    expect(html).toContain(`href="data:image/svg+xml,${encodeURIComponent(siteSignature("simetrix").monogram!)}"`);
    site.theme = "digita";
    expect(renderToStaticMarkup(await BrandMark())).toContain(encodeURIComponent(siteSignature("digita").monogram!));
  });

  it("PLANTED INNOCENT: a site whose signature has no monogram gets no figure", async () => {
    registerSignature({ id: "plain", name: "Plain", accent: "#336699" });
    site.theme = "plain";
    expect(await BrandMark()).toBeNull();
  });
});

/** The texts of a code app row, as a site seed writes them. */
const APP: P = {
  form_title: "Order · O-7",
  form_status: "open",
  fields: [
    { label: "Buyer", value: "Example Ltd" },
    { label: "Date", value: "2026-01-02" },
  ],
  columns: ["Item", "Count", "Sum"],
  lines: [
    { product: "Widget", qty: "3", total: "€30.00" },
    { product: "Gadget", qty: "1", total: "€5.00" },
  ],
  total_label: "Total",
  grand_total: "€35.00",
  footer: "made from one file",
  definition_title: "order.json",
  definition_tag: "source",
  definition: ["{", '  "name": "Order",   // the entity', "}"],
};

describe("the code-app plugin", () => {
  it("draws the form and its definition from the props, and the toggle and hint as chrome texts", () => {
    const html = renderToStaticMarkup(<CodeApp props={APP} locale="en" />);
    for (const text of ["Order · O-7", "open", "Buyer", "Example Ltd", "2026-01-02", "Item", "Count", "Sum", "Widget", "Gadget", "€30.00", "Total", "€35.00", "made from one file", "order.json", "source"])
      expect(html, text).toContain(text);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('aria-label="Show the code behind the form"');
    expect(html).toContain("hover or tap to see the code");
    // Keys take the accent, comments are muted.
    expect(html).toContain('<span class="text-primary-600">&quot;name&quot;</span>');
    expect(html).toContain('<span class="text-textMuted">// the entity</span>');
  });

  it("PLANTED DEFECT: without a definition there is nothing to reveal, and nothing is drawn", () => {
    const { definition: _dropped, ...rest } = APP;
    expect(renderToStaticMarkup(<CodeApp props={rest} locale="en" />)).toBe("");
    expect(renderToStaticMarkup(<CodeApp props={{ ...APP, definition: 42 }} locale="en" />)).toBe("");
    expect(renderToStaticMarkup(<CodeApp props={undefined} locale="en" />)).toBe("");
  });
});
