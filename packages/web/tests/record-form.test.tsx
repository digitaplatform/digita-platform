// @vitest-environment jsdom
// The record form draws the fields its props name with the kit's inputs, in their order, posts the
// record the visitor filled in to /api/record and thanks them; it draws nothing it cannot send.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { getBlockComponent } from "../src/blocks/registry";
import { readRecordFormFields } from "../src/blocks/record-form";
import { RecordFormFields, recordValues } from "../src/blocks/RecordFormFields";
import { setSiteEnv } from "./site-env";
import { TEST_FORM_KEY } from "./signed-form";

vi.mock("server-only", () => ({}));
setSiteEnv();
process.env.ENGINE_URLS = JSON.stringify({ workshop: "http://workshop.internal:3000" });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out, so it has no scrollIntoView, which the kit's Select calls on its open menu.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

/** The Veloluck booking form: the workshop's Booking fields a visitor fills in. */
const booking = {
  heading: "Book a service",
  app: "workshop",
  entity: "Booking",
  fields: [
    { name: "contact_name", label: "Name", required: true, max_length: 120 },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone", type: "tel" },
    {
      name: "service_code",
      label: "Service",
      type: "select",
      required: true,
      options: [
        { value: "basic_check", label: "Basic check" },
        { value: "full_service", label: "Full service" },
      ],
    },
    { name: "bike_description", label: "Bike and problem", type: "textarea", required: true, max_length: 500 },
    { name: "is_ebike", label: "E-bike", type: "checkbox" },
    { name: "preferred_at", label: "Preferred date", type: "datetime-local" },
    { name: "consent_privacy", label: "I agree to the privacy notice", type: "checkbox", required: true },
    { name: "page_locale", type: "hidden", value: "en" },
  ],
  send_label: "Request booking",
  thanks: "Thank you. We confirm your booking by email.",
};

const render = (props: Record<string, unknown>) => {
  const Block = getBlockComponent("record_form");
  if (!Block) throw new Error("record_form is not registered");
  return renderToStaticMarkup(<Block props={props} locale="en" site={null} />);
};

let root: Root | null = null;
// A server clock far from the browser's, so a value the browser made up cannot pass for it.
const RENDERED_AT = 1_000_000;
const SIGNATURE = "the-signature-the-server-made";

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const texts = { send: "Request booking", sent: booking.thanks, failed: "Sending failed." };
  await act(async () =>
    root!.render(<RecordFormFields app="workshop" entity="Booking" fields={readRecordFormFields(booking)} texts={texts} renderedAt={RENDERED_AT} signature={SIGNATURE} />),
  );
}

/** Types into a controlled input as a person does: the value, then the input event React reads. */
async function type(name: string, value: string) {
  const element = document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function fillIn() {
  await type("contact_name", "Ada Example");
  await type("email", "ada@example.org");
  await type("bike_description", "The rear brake squeaks.");
  await act(async () => (document.querySelector('[name="consent_privacy"]') as HTMLInputElement).click());
  await act(async () => (document.querySelector('[data-ui="select-trigger"]') as HTMLButtonElement).click());
  const fullService = [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === "Full service");
  await act(async () => (fullService as HTMLElement).click());
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the record_form block", () => {
  it("draws each visible field with its label and the kit's input, in the order of its props", () => {
    const html = render(booking);
    expect(html).toContain("Book a service");
    const labels = ["Name", "Email", "Phone", "Service", "Bike and problem", "E-bike", "Preferred date", "I agree to the privacy notice"];
    const positions = labels.map((label) => html.indexOf(`>${label}<`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('type="email"');
    expect(html).toContain('type="tel"');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('maxLength="120"');
    expect(html).toMatch(/<textarea[^>]*name="bike_description"[^>]*required=""/);
    expect(html).toMatch(/data-ui="select-trigger"[^>]*>.*Basic check/);
    expect(html.match(/data-ui="checkbox"/g)).toHaveLength(2);
    expect(html).toContain("Request booking");
    // A hidden field is sent, never shown.
    expect(html).not.toContain("page_locale");
  });

  it("PLANTED INNOCENT: without a button label or a thank-you text it takes the site's own texts", () => {
    const { send_label: _s, thanks: _t, ...bare } = booking;
    expect(render(bare)).toContain(">Send<");
  });

  it("PLANTED DEFECT: draws nothing without an entity, without a visible field, or for an app whose engine the site does not know", () => {
    const { entity: _e, ...noEntity } = booking;
    expect(render(noEntity)).toBe("");
    expect(render({ ...booking, fields: [{ name: "page_locale", type: "hidden", value: "en" }] })).toBe("");
    expect(render({ ...booking, fields: [{ name: "contact_name" }, { label: "No name" }, { name: "service_code", label: "Service", type: "select" }] })).toBe("");
    expect(render({ ...booking, app: "erp" })).toBe("");
    expect(render({ ...booking, app: "" })).not.toBe("");
  });

  it("PLANTED DEFECT: signs the app, the entity and every field it sends, hidden ones too, with the render time", async () => {
    const { readSignedForm } = await import("../src/lib/form-signature");
    const { RecordForm } = await import("../src/blocks/RecordForm");
    const before = Date.now();
    // The section holds the client form, whose props reach the browser as they are.
    const section = RecordForm({ props: booking, locale: "en" }) as { props: { children: { props: { signature: string; renderedAt: number } } } };
    const { signature, renderedAt } = section.props.children.props;
    const form = readSignedForm(TEST_FORM_KEY, signature);
    expect(form).toMatchObject({ app: "workshop", entity: "Booking", fields: booking.fields.map((field) => field.name) });
    expect(form!.renderedAt).toBe(renderedAt);
    expect(renderedAt).toBeGreaterThanOrEqual(before);
  });

  it("fails a page that places a form on a renderer without the signing key", async () => {
    vi.resetModules();
    const key = process.env.FORM_SIGNING_KEY;
    delete process.env.FORM_SIGNING_KEY;
    try {
      const { RecordForm } = await import("../src/blocks/RecordForm");
      expect(() => renderToStaticMarkup(<RecordForm props={booking} locale="en" />)).toThrow("missing required env var: FORM_SIGNING_KEY");
    } finally {
      process.env.FORM_SIGNING_KEY = key;
      vi.resetModules();
    }
  });

  it("posts the record the visitor filled in, the render time and the empty honeypot to /api/record, and thanks them", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    await fillIn();
    await act(async () => document.querySelector("form")!.requestSubmit());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/record");
    expect(JSON.parse(String(init.body))).toEqual({
      app: "workshop",
      entity: "Booking",
      values: {
        contact_name: "Ada Example",
        email: "ada@example.org",
        service_code: "full_service",
        bike_description: "The rear brake squeaks.",
        is_ebike: false,
        consent_privacy: true,
        page_locale: "en",
      },
      website: "",
      rendered_at: RENDERED_AT,
      form: SIGNATURE,
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(booking.thanks);
    expect(document.querySelector("form")).toBeNull();
  });

  it("keeps the form and says so when the route refuses the record", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false }, { status: 403 })));
    await mount();
    await fillIn();
    await act(async () => document.querySelector("form")!.requestSubmit());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Sending failed.");
    expect((document.querySelector('[name="contact_name"]') as HTMLInputElement).value).toBe("Ada Example");
  });
});

describe("recordValues", () => {
  const fields = readRecordFormFields({
    fields: [
      { name: "count", label: "Count", type: "number" },
      { name: "preferred_at", label: "When", type: "datetime-local" },
      { name: "is_ebike", label: "E-bike", type: "checkbox" },
      { name: "message", label: "Message", type: "textarea" },
      { name: "page_locale", type: "hidden", value: "de" },
    ],
  });

  it("sends a number as a number, a datetime as its instant, a checkbox as a boolean and a hidden field's value", () => {
    const record = recordValues(fields, { count: " 2 ", preferred_at: "2026-10-05T10:30", is_ebike: true, message: "  Squeaks.  " });
    expect(record).toEqual({ count: 2, preferred_at: new Date("2026-10-05T10:30").toISOString(), is_ebike: true, message: "Squeaks.", page_locale: "de" });
  });

  it("PLANTED INNOCENT: leaves an empty field out, so the engine applies its default and its own required check", () => {
    expect(recordValues(fields, { count: "", preferred_at: "", is_ebike: false, message: "   " })).toEqual({ is_ebike: false, page_locale: "de" });
  });
});
