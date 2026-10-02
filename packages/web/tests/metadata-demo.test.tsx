// @vitest-environment jsdom
// The metadata demo draws what the block that names it carries: the definition, the API answer and
// the form, in the page's language. Only the panel tags and the label of the whole are the site's
// texts. A block that carries no definition draws nothing.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { P } from "../src/blocks/marketing/shared";
import { setSiteEnv } from "./site-env";

vi.mock("server-only", () => ({}));
setSiteEnv();

const { default: MetadataDemo } = await import("../src/plugins/metadata-demo");

const props = (locale: "en" | "de"): P => ({
  definition_title: "work-order.entity.json",
  definition: ['{ "name": "WorkOrder",', '  "naming": { "expression": "WO-{YYYY}-{#####}" } }'],
  api_title: "GET /api/v1/resource/WorkOrder/WO-2026-00042",
  api: ['{ "_id": "WO-2026-00042", "status": "in_repair" }'],
  form_title: locale === "de" ? "Werkstattauftrag" : "Work order",
  fields: [{ label: locale === "de" ? "Kunde" : "Customer", value: "Anna Muster" }],
  columns: locale === "de" ? ["Teil", "Menge"] : ["Part", "Qty"],
  rows: [{ cells: [locale === "de" ? "Kette" : "Chain", "1"] }],
  states: locale === "de" ? ["Eingegangen", "In Reparatur", "Fertig"] : ["Received", "In repair", "Done"],
  state: locale === "de" ? "In Reparatur" : "In repair",
});

describe("the metadata demo", () => {
  it("draws the definition, the API answer and the form from its props, in English", () => {
    const html = renderToStaticMarkup(<MetadataDemo props={props("en")} locale="en" />);
    for (const text of ["work-order.entity.json", "WO-{YYYY}-{#####}", "GET /api/v1/resource/WorkOrder/WO-2026-00042", "Work order", "Customer", "Anna Muster", "Chain", "Received"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('aria-label="How one entity definition becomes an API and a form"');
    expect(html).toMatch(/>define<.*>api<.*>form</s);
    expect(html).toMatch(/aria-current="step"[^>]*>In repair</);
  });

  it("draws the German props with the German tags and label", () => {
    const html = renderToStaticMarkup(<MetadataDemo props={props("de")} locale="de" />);
    for (const text of ["Werkstattauftrag", "Kunde", "Kette", "Eingegangen"]) expect(html).toContain(text);
    expect(html).toContain('aria-label="Wie aus einer Entitätsdefinition eine API und ein Formular werden"');
    expect(html).toMatch(/>definieren<.*>API<.*>Formular</s);
    expect(html).not.toContain(">define<");
  });

  it("draws nothing without props, and nothing without a definition", () => {
    expect(renderToStaticMarkup(<MetadataDemo locale="en" />)).toBe("");
    const { definition: _dropped, ...rest } = props("en");
    expect(renderToStaticMarkup(<MetadataDemo props={rest} locale="en" />)).toBe("");
  });

  it("PLANTED INNOCENT: a definition alone draws its panel and the form's title, without an API panel", () => {
    const html = renderToStaticMarkup(<MetadataDemo props={{ definition: ['{ "name": "Note" }'], form_title: "Note" }} locale="en" />);
    expect(html).toContain("&quot;name&quot;");
    expect(html).not.toContain(">api<");
  });

  it("names no sales order and no fixed customer of its own", () => {
    const html = renderToStaticMarkup(<MetadataDemo props={props("en")} locale="en" />);
    expect(html).not.toMatch(/sales ?order|Veloluck GmbH|Aurora Lamp/i);
  });
});
