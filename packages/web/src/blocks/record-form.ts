import { type P, list, s } from "./marketing/shared";

/** The inputs a record form draws, spelled as the HTML input type where one is meant; each maps to
 *  the entity field types the engine's public create takes (Data, Phone, Text, Select, Check, …). */
export const RECORD_FORM_INPUTS = [
  "text",
  "email",
  "tel",
  "number",
  "date",
  "datetime-local",
  "time",
  "textarea",
  "select",
  "checkbox",
  "hidden",
] as const;
export type RecordFormInput = (typeof RECORD_FORM_INPUTS)[number];

/** One field of the form, named as the entity names it. */
export interface RecordFormField {
  name: string;
  label: string;
  type: RecordFormInput;
  required: boolean;
  maxLength?: number;
  /** The choices of a select; the first is chosen until the visitor picks another. */
  options: { value: string; label: string }[];
  /** What a hidden input sends, such as the page's language. */
  value: string;
}

const isInput = (type: string): type is RecordFormInput => (RECORD_FORM_INPUTS as readonly string[]).includes(type);

/** The fields of a record form's props in their order. An item the form cannot draw is left out:
 *  one without a name, a visible one without a label, a select without a choice. An absent or
 *  unknown input is a line of text. */
export function readRecordFormFields(props: P | undefined): RecordFormField[] {
  return list(props, "fields").flatMap((item) => {
    const name = s(item, "name");
    const label = s(item, "label");
    const type = isInput(s(item, "type")) ? (s(item, "type") as RecordFormInput) : "text";
    const options = list(item, "options")
      .map((option) => ({ value: s(option, "value"), label: s(option, "label") }))
      .filter((option) => option.value && option.label);
    if (!name || (type !== "hidden" && !label) || (type === "select" && !options.length)) return [];
    const maxLength = typeof item.max_length === "number" && item.max_length > 0 ? item.max_length : undefined;
    return [{ name, label, type, required: item.required === true, maxLength, options, value: s(item, "value") }];
  });
}
