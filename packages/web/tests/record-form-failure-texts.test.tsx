// The record_form block gives its form a text for every class of failure, in the page's locale, so the
// form can say why a post failed instead of one line for all of them.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { setSiteEnv } from "./site-env";

vi.mock("server-only", () => ({}));
// The text of a key is the key and the locale, so the test reads which key went where and needs no translations.
vi.mock("../src/i18n/messages", () => ({ t: (key: string, locale: string) => `${key}:${locale}` }));
const form = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }));
vi.mock("../src/blocks/RecordFormFields", () => ({
  RecordFormFields: (props: Record<string, unknown>) => {
    form.props = props;
    return null;
  },
}));
setSiteEnv();

const { RecordForm } = await import("../src/blocks/RecordForm");

const lead = { entity: "Lead", fields: [{ name: "email", label: "Email" }] };

describe("the record_form block", () => {
  it("PLANTED DEFECT: hands its form the text of each class of failure and the page's locale", () => {
    renderToStaticMarkup(<RecordForm props={lead} locale="de" />);
    expect(form.props).toMatchObject({
      locale: "de",
      texts: {
        failed: "recordFormFailed:de",
        invalidField: "recordFormInvalidField:de",
        unavailable: "recordFormUnavailable:de",
        tooMany: "recordFormTooMany:de",
      },
    });
  });

  it("PLANTED INNOCENT: still takes the button and thank-you texts from its props before the site's", () => {
    renderToStaticMarkup(<RecordForm props={{ ...lead, send_label: "Request booking", thanks: "We confirm by email." }} locale="en" />);
    expect(form.props).toMatchObject({ texts: { send: "Request booking", sent: "We confirm by email." } });
  });
});
