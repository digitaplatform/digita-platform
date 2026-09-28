// @vitest-environment jsdom
// Every marketing block renders its props, and renders nothing, without throwing, when the prop it
// cannot do without is missing: an editor saves a block half filled in, and the page still serves.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { getBlockComponent } from "../src/blocks/registry";
import type { BlockType } from "../src/lib/types";
import { closeContactSheet, useContactSheetOpen } from "../src/lib/contact-sheet";
import { ConfigProvider } from "../src/config/ConfigProvider";
import type { PublicSiteConfig } from "../src/config/public";
import { setSiteEnv } from "./site-env";

// The registry reaches the server config through the media block; the guard that keeps it out of
// a browser bundle has nothing to guard in a test.
vi.mock("server-only", () => ({}));
setSiteEnv();

const siteConfig = (contactEnabled: boolean): PublicSiteConfig => ({
  siteId: "example",
  siteUrl: "https://example.org",
  publicEngineUrl: "",
  locales: ["en"],
  defaultLocale: "en",
  contactEnabled,
});

const render = (type: BlockType, props?: Record<string, unknown>, contactEnabled = true) => {
  const Block = getBlockComponent(type);
  if (!Block) throw new Error(`${type} is not registered`);
  return renderToStaticMarkup(
    <ConfigProvider value={siteConfig(contactEnabled)}>
      <Block props={props} locale="en" />
    </ConfigProvider>,
  );
};

const sheet = { label: "Book a call", action: "sheet" };
const link = { label: "See how we work", href: "/how-we-work" };

/** Each block with full props, the text that proves it rendered them, and the prop it needs. */
const CASES: { type: BlockType; props: Record<string, unknown>; shows: string[]; required: string }[] = [
  {
    type: "hero_brand",
    props: { eyebrow: "Company", heading: "Your business, as software.", lede: "Described once.", primary: sheet, secondary: link, visual: "simetrix-mark" },
    shows: ["<h1", "Your business, as software.", "Described once.", "Book a call", 'href="/how-we-work"', "mark-aura"],
    required: "heading",
  },
  {
    type: "pillars",
    props: { eyebrow: "The concept", heading: "Describe. Generate.", items: [1, 2, 3, 4].map((n) => ({ num: `0${n}`, title: `Step ${n}`, body: "Body" })) },
    shows: ["The concept", "Describe. Generate.", "04", "Step 4", "lg:grid-cols-4"],
    required: "items",
  },
  {
    type: "stack",
    props: {
      heading: "We build the tools we build with.",
      items: [
        { lockup: { family: "digita", product: "platform" }, body: "The build layer.", status: "available", href: "https://example.org", link_label: "See the platform" },
        { lockup: null, title: "Shop", body: "Register, order.", status: "coming" },
      ],
    },
    shows: ['aria-label="digita platform"', "The build layer.", ">available<", "See the platform", "Shop", ">coming<"],
    required: "items",
  },
  {
    type: "pipeline",
    props: { heading: "Four steps.", stages: [{ stage: "01", title: "Conversation", body: "You tell us.", target: "30 minutes" }] },
    shows: ["Four steps.", "Conversation", "30 minutes"],
    required: "stages",
  },
  {
    type: "compare",
    props: { heading: "The comparison.", columns: ["Classic custom build", "With digita"], rows: [{ aspect: "Timeline", a: "Estimated.", b: "Calculable." }] },
    shows: ["Classic custom build", "With digita", "Timeline", "Estimated.", "Calculable."],
    required: "rows",
  },
  {
    type: "checklist",
    props: { heading: "Included.", items: [{ what: "Six languages", note: "en, de, fr, it, es, tr" }] },
    shows: ["Included.", "Six languages", "en, de, fr, it, es, tr"],
    required: "items",
  },
  {
    type: "segments",
    props: { heading: "Who it is for.", items: [{ mark: "01", title: "IT system houses", who: "Mid-market partners.", gain: "Recurring revenue." }] },
    shows: ["IT system houses", "Mid-market partners.", "Recurring revenue."],
    required: "items",
  },
  {
    type: "signals",
    props: { eyebrow: "Signals", items: ["You deliver software to clients"], note: "Not built for end customers." },
    shows: ["You deliver software to clients", "Not built for end customers."],
    required: "items",
  },
  {
    type: "cta_panel",
    props: { heading: "Let's talk about your business.", body: "Thirty minutes.", primary: sheet, secondary: { label: "Write to us", href: "/contact" } },
    shows: ["Let&#x27;s talk about your business.", "Thirty minutes.", "Book a call", 'href="/contact"', "rounded-dialog"],
    required: "heading",
  },
  {
    type: "contact_details",
    props: { heading: "Contact", address: ["Example GmbH", "Street 1"], email: "hello@example.org", phone: "+41 00 000 00 00" },
    shows: ["<address", "Street 1", 'href="mailto:hello@example.org"', 'href="tel:+41000000000"'],
    required: "address",
  },
  {
    type: "showcase",
    props: { heading: "From a definition to running software.", plugin_id: "metadata-demo", caption: "The definition on the left." },
    shows: ["From a definition to running software.", "The definition on the left."],
    required: "plugin_id",
  },
];

describe("the marketing blocks", () => {
  for (const { type, props, shows } of CASES) {
    it(`${type} renders its props`, () => {
      const html = render(type, props);
      for (const text of shows) expect(html, text).toContain(text);
    });
  }

  it("PLANTED DEFECT: a block without its required prop renders nothing and does not throw", () => {
    for (const { type, props, required } of CASES) {
      const { [required]: _dropped, ...rest } = props;
      expect(render(type, rest), type).toBe("");
      expect(render(type, undefined), type).toBe("");
      expect(render(type, { ...props, [required]: 42 }), `${type} with a number for ${required}`).toBe("");
    }
  });

  it("renders no call to action that has nowhere to go", () => {
    const html = render("cta_panel", { heading: "Talk.", primary: { label: "Book a call" }, secondary: { href: "/contact" } });
    expect(html).toContain("Talk.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });

  it("offers no sheet action on a site without the contact sheet, and keeps its links", () => {
    const props = { heading: "Talk.", primary: sheet, secondary: link };
    expect(render("cta_panel", props, true)).toContain("<button");
    expect(render("cta_panel", props, false)).not.toContain("<button");
    expect(render("cta_panel", props, false)).toContain('href="/how-we-work"');
  });

  it("shows the booking button only once a booking link exists", () => {
    const base = { address: ["Example GmbH"], booking_label: "Book a 30-minute call" };
    expect(render("contact_details", base)).not.toContain("Book a 30-minute call");
    expect(render("contact_details", { ...base, booking_url: "" })).not.toContain("Book a 30-minute call");
    expect(render("contact_details", { ...base, booking_url: "https://example.org/book" })).toContain('href="https://example.org/book"');
  });

  it("gives every status its own pill and none to an unknown one", () => {
    const html = (status: string) => render("stack", { items: [{ title: "App", status }] });
    expect(html("available")).toContain("bg-primary-100");
    expect(html("early_access")).toContain(">early access<");
    expect(html("early_access")).toContain("border-primary-300");
    expect(html("coming")).toContain("text-textMuted");
    expect(html("toString")).not.toContain("rounded-full");
  });

  it("lays four pillars in four columns and three in three, never three and one", () => {
    const pillars = (n: number) => render("pillars", { items: Array.from({ length: n }, (_, i) => ({ title: `P${i}` })) });
    expect(pillars(4)).toContain("lg:grid-cols-4");
    expect(pillars(3)).toContain("md:grid-cols-3");
    expect(pillars(3)).not.toContain("grid-cols-4");
  });

  it("hero_brand draws the code app, the reveal and the data rain on request", () => {
    const hero = (extra: Record<string, unknown>) => render("hero_brand", { heading: "One file. A whole app.", visual: "code-app", ...extra });
    expect(hero({})).toContain("POST /api/v1/resource/SalesOrder");
    expect(hero({})).not.toContain('type="checkbox"');
    expect(hero({ reveal: true })).toContain('type="checkbox"');
    expect(hero({ reveal: true })).toContain("the code behind");
    expect(hero({})).not.toContain("rain-fall");
    expect(hero({ atmosphere: "data-rain" })).toContain("motion-reduce:hidden");
    expect(hero({ visual: "none" })).not.toContain("<svg");
  });

  it("keeps the restyled stats and cta props working", () => {
    const stats = render("stats", { items: [{ value: "Founded 2013", label: "Swiss company" }, { value: "Own cloud", label: "coming" }] });
    expect(stats).toContain("Founded 2013");
    expect(stats).toContain("border-l pl-6");
    const cta = render("cta", { heading: "Start.", cta_label: "Go", cta_href: "/go" });
    expect(cta).toContain("rounded-dialog");
    expect(cta).toContain('href="/go"');
  });
});

describe("the contact sheet", () => {
  afterEach(() => closeContactSheet());

  it("opens when a sheet action is clicked", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const Block = getBlockComponent("cta_panel")!;
    function Probe() {
      return <output>{useContactSheetOpen() ? "open" : "closed"}</output>;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ConfigProvider value={siteConfig(true)}>
          <Block props={{ heading: "Talk.", primary: sheet }} locale="en" />
          <Probe />
        </ConfigProvider>,
      ),
    );
    expect(container.querySelector("output")?.textContent).toBe("closed");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("output")?.textContent).toBe("open");
    await act(async () => root.unmount());
  });
});
