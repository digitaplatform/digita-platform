// @vitest-environment jsdom
// A form that fails tells the visitor why, by the class of the answer: a wrong field is named, a form
// that cannot be sent right now says so without blaming the input, and a visitor who sent too many
// forms is told when to try again. The record form and the contact sheet tell it alike.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ContactSheet, type ContactSheetTexts } from "../src/components/ContactSheet";
import { RecordFormFields, type RecordFormTexts } from "../src/blocks/RecordFormFields";
import { readRecordFormFields } from "../src/blocks/record-form";
import { closeContactSheet, openContactSheet } from "../src/lib/contact-sheet";
import { failureText, readFormFailure, waitPhrase } from "../src/lib/form-failure";

vi.mock("server-only", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out, so it has no scrollIntoView, which the kit's Select calls on its open menu.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

/** Marker texts: each class of failure has its own, so a test sees which one the visitor got. */
const failureTexts = { failed: "FAILED", invalidField: "CORRECT {field}", unavailable: "UNAVAILABLE", tooMany: "TOO MANY {time}" };

let root: Root | null = null;

async function unmount() {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
}

afterEach(async () => {
  await act(async () => closeContactSheet());
  await unmount();
  vi.unstubAllGlobals();
});

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

const alertText = () => document.querySelector('[role="alert"]')?.textContent;

/** The two forms behind one interface: `send` fills in what the form requires and submits it, and
 *  `told` is what the alert reads for a failure text, which the sheet follows with its address. */
interface FormUnderTest {
  name: string;
  mount: (texts: Partial<typeof failureTexts>) => Promise<void>;
  send: () => Promise<void>;
  told: (text: string) => string;
}

const recordForm: FormUnderTest = {
  name: "record form",
  mount: (texts) =>
    render(
      <RecordFormFields
        app=""
        entity="Booking"
        fields={readRecordFormFields({
          fields: [
            { name: "email", label: "Email", type: "email" },
            { name: "page_locale", type: "hidden", value: "en" },
          ],
        })}
        texts={{ send: "Send", sent: "Thanks", ...texts } as RecordFormTexts}
        renderedAt={1_000_000}
        signature="a-signature"
        locale="en"
      />,
    ),
  send: () => act(async () => document.querySelector("form")!.requestSubmit()),
  told: (text) => text,
};

const contactSheet: FormUnderTest = {
  name: "contact sheet",
  mount: async (texts) => {
    const sheetTexts: ContactSheetTexts = {
      title: "Contact", heading: "Talk", close: "Close", lede: "Lede", book: "Book", orWrite: "or", name: "Name", email: "Email",
      company: "Company", topic: "Topic", message: "Message", messagePlaceholder: "", send: "Send", sent: "Sent", privacyNote: "",
      privacy: "Privacy", topics: { contact: "Contact", trial: "Trial", early_access: "Early access" }, failed: "FAILED", ...texts,
    };
    await render(<ContactSheet locale="en" texts={sheetTexts} contactEmail="hello@example.org" privacyHref="/privacy" renderedAt={1_000_000} />);
    await act(async () => openContactSheet());
  },
  send: async () => {
    const filled = { name: "Ada Example", email: "ada@example.org", message: "We want to digitalize." };
    for (const [name, value] of Object.entries(filled)) (document.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
    await act(async () => document.querySelector("form")!.requestSubmit());
  },
  told: (text) => `${text} hello@example.org.`,
};

const answering = (response: Response) => vi.stubGlobal("fetch", vi.fn(async () => response));
const answer = (status: number, body: object = { ok: false }, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

describe.each([recordForm, contactSheet])("the $name", (form) => {
  it("PLANTED DEFECT: names the field to correct, by its label, when the route names one", async () => {
    answering(answer(400, { ok: false, message: "Invalid request", field: "email" }));
    await form.mount(failureTexts);
    await form.send();
    // One text for every failure tells this visitor to check everything; this goes red then.
    expect(alertText()).toBe(form.told("CORRECT Email"));
  });

  it("PLANTED DEFECT: does not blame the input when the route refuses the form (403) or has no engine for it (503)", async () => {
    for (const status of [403, 503]) {
      answering(answer(status));
      await form.mount(failureTexts);
      await form.send();
      expect(alertText(), String(status)).toBe(form.told("UNAVAILABLE"));
      await unmount();
    }
  });

  it("PLANTED DEFECT: does not blame the input when the server fails (500) or cannot be reached", async () => {
    answering(answer(500));
    await form.mount(failureTexts);
    await form.send();
    expect(alertText()).toBe(form.told("UNAVAILABLE"));
    await unmount();

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await form.mount(failureTexts);
    await form.send();
    expect(alertText()).toBe(form.told("UNAVAILABLE"));
  });

  it("PLANTED DEFECT: tells a visitor over the budget (429) that they sent too many, and when to try again", async () => {
    answering(answer(429, { ok: false, message: "Too many requests" }, { "Retry-After": "120" }));
    await form.mount(failureTexts);
    await form.send();
    expect(alertText()).toBe(form.told("TOO MANY in 2 minutes"));
    await unmount();

    answering(answer(429, { ok: false }, { "Retry-After": "3600" }));
    await form.mount(failureTexts);
    await form.send();
    expect(alertText()).toBe(form.told("TOO MANY in 1 hour"));
  });

  it("PLANTED INNOCENT: still asks for a check of the details when the post was wrong and no field is named or the field is not one the visitor sees", async () => {
    for (const response of [answer(400), answer(400, { ok: false, field: "internal_note" }), answer(413)]) {
      answering(response);
      await form.mount(failureTexts);
      await form.send();
      expect(alertText(), String(response.status)).toBe(form.told("FAILED"));
      await unmount();
    }
  });

  it("PLANTED INNOCENT: without a wait to name, a 429 says the form cannot be sent right now, and invents no time", async () => {
    answering(answer(429));
    await form.mount(failureTexts);
    await form.send();
    expect(alertText()).toBe(form.told("UNAVAILABLE"));
  });

  it("PLANTED INNOCENT: a form that carries only its failure text tells every failure with it", async () => {
    answering(answer(403));
    await form.mount({ failed: "FAILED" });
    await form.send();
    expect(alertText()).toBe(form.told("FAILED"));
  });
});

describe("readFormFailure", () => {
  it("sorts an answer by its status, and takes the field of a 400 and the wait of a 429 from the answer", async () => {
    expect(await readFormFailure(answer(400, { field: "email" }))).toEqual({ kind: "invalid", field: "email" });
    expect(await readFormFailure(answer(400))).toEqual({ kind: "invalid" });
    expect(await readFormFailure(new Response("<html>", { status: 400 }))).toEqual({ kind: "invalid" });
    expect(await readFormFailure(answer(413))).toEqual({ kind: "invalid" });
    expect(await readFormFailure(answer(403))).toEqual({ kind: "unavailable" });
    expect(await readFormFailure(answer(503))).toEqual({ kind: "unavailable" });
    expect(await readFormFailure(answer(429, {}, { "Retry-After": "90" }))).toEqual({ kind: "tooMany", waitSeconds: 90 });
  });

  it("PLANTED INNOCENT: takes no wait from a Retry-After that is no count of seconds", async () => {
    for (const header of ["", "0", "-5", "soon", "Wed, 21 Oct 2026 07:28:00 GMT"]) {
      expect(await readFormFailure(answer(429, {}, header ? { "Retry-After": header } : {})), header).toEqual({ kind: "tooMany", waitSeconds: undefined });
    }
  });
});

describe("waitPhrase", () => {
  it("words a wait in the visitor's language, rounded up so nobody tries too early", () => {
    expect(waitPhrase(1, "en")).toBe("in 1 minute");
    expect(waitPhrase(61, "en")).toBe("in 2 minutes");
    expect(waitPhrase(300, "de")).toBe("in 5 Minuten");
    expect(waitPhrase(300, "fr")).toBe("dans 5 minutes");
    expect(waitPhrase(3600, "en")).toBe("in 1 hour");
    expect(waitPhrase(7200, "de")).toBe("in 2 Stunden");
    expect(waitPhrase(5400, "en")).toBe("in 90 minutes");
  });
});

describe("failureText", () => {
  it("fills the label into a field's text as it is, without reading $ patterns in it", () => {
    expect(failureText({ kind: "invalid", field: "price" }, failureTexts, () => "Price in $&")).toBe("CORRECT Price in $&");
  });
});
