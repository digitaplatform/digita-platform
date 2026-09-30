// @vitest-environment jsdom
// The metadata demo shows the showcase's own fictional company, never a name a real firm may carry.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useParams: () => ({ locale: "en" }) }));

describe("the metadata demo", () => {
  it("names Veloluck GmbH in the JSON panel and in the form, and no other customer", async () => {
    const { default: MetadataDemo } = await import("../src/plugins/metadata-demo/index");
    const html = renderToStaticMarkup(<MetadataDemo />);
    expect(html.match(/Veloluck GmbH/g) ?? []).toHaveLength(2);
    expect(html).not.toMatch(/acme/i);
  });
});
