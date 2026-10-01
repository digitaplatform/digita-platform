"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Checkbox, Input, Select, buttonAttributes } from "@digitaplatform/components";
import { failureText, readFormFailure, type FormFailure, type FormFailureTexts } from "@/lib/form-failure";
import type { RecordFormField } from "./record-form";

/** The form's texts in the page's locale, from the block's props or the site's texts. */
export interface RecordFormTexts extends FormFailureTexts {
  send: string;
  sent: string;
}

type FieldState = Record<string, string | boolean>;

/** The record the form sends, each value as its entity field takes it. An empty value is left out,
 *  so the engine applies the field's default and its own required check. A datetime is sent as
 *  the instant the visitor meant in their own time zone. */
export function recordValues(fields: RecordFormField[], state: FieldState): Record<string, string | number | boolean> {
  const record: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const value = field.type === "hidden" ? field.value : state[field.name];
    if (typeof value === "boolean") {
      record[field.name] = value;
      continue;
    }
    const text = (value ?? "").trim();
    if (!text) continue;
    record[field.name] = field.type === "number" ? Number(text) : field.type === "datetime-local" ? new Date(text).toISOString() : text;
  }
  return record;
}

const initialState = (fields: RecordFormField[]): FieldState =>
  Object.fromEntries(fields.map((field) => [field.name, field.type === "checkbox" ? false : field.type === "select" ? field.options[0]!.value : ""]));

// The kit has no multi-line input, so the text area wears the kit Input's label and frame.
const LABEL = "text-xs font-medium text-textMuted";
const TEXTAREA =
  "min-h-[5.5rem] w-full resize-y rounded-input border border-border bg-surface px-3 py-2.5 text-sm text-textMain transition duration-base ease-smooth placeholder:text-neutral-400 focus:border-primary-400 focus:shadow-focus focus:outline-none";

interface RecordFormFieldsProps {
  app: string;
  entity: string;
  fields: RecordFormField[];
  texts: RecordFormTexts;
  /** When the server rendered the page, in its clock. The form sends it back unchanged, so the
   *  route's fill-time check measures a person's time from the server's render, not from the
   *  browser's clock. A program that sends a number of its own passes the check. */
  renderedAt: number;
  /** The page's language, which words the wait of a visitor who sent too many forms. */
  locale?: string;
}

/** The record form's inputs, drawn with the kit's controls, and its post to /api/record. */
export function RecordFormFields({ app, entity, fields, texts, renderedAt, locale }: RecordFormFieldsProps) {
  const formId = useId();
  const honeypot = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState(() => initialState(fields));
  const [state, setState] = useState<"editing" | "sending" | "sent" | "failed">("editing");
  const [failure, setFailure] = useState<FormFailure>({ kind: "invalid" });
  const set = (name: string, value: string | boolean) => setValues((current) => ({ ...current, [name]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app, entity, values: recordValues(fields, values), website: honeypot.current?.value ?? "", rendered_at: renderedAt }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      setFailure(await readFormFailure(res));
    } catch {
      // No answer came: the visitor's connection or the server is down, and nothing they typed is wrong.
      setFailure({ kind: "unavailable" });
    }
    setState("failed");
  }

  if (state === "sent") {
    return (
      <p role="status" className="max-w-2xl text-pretty text-lg leading-relaxed text-textMain">
        {texts.sent}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      {fields.map((field) => {
        const id = `${formId}-${field.name}`;
        const value = values[field.name];
        switch (field.type) {
          case "hidden":
            return null;
          case "checkbox":
            return (
              <Checkbox
                key={field.name}
                id={id}
                name={field.name}
                label={field.label}
                required={field.required}
                checked={value === true}
                onChange={(event) => set(field.name, event.target.checked)}
              />
            );
          case "select":
            return (
              <Select
                key={field.name}
                id={id}
                name={field.name}
                label={field.label}
                options={field.options}
                value={String(value)}
                onChange={(choice) => set(field.name, choice)}
                aria-required={field.required || undefined}
              />
            );
          case "textarea":
            return (
              <div key={field.name} className="flex flex-col gap-1.5">
                <label htmlFor={id} className={LABEL}>
                  {field.label}
                </label>
                <textarea
                  id={id}
                  name={field.name}
                  rows={4}
                  required={field.required}
                  maxLength={field.maxLength}
                  value={String(value)}
                  onChange={(event) => set(field.name, event.target.value)}
                  className={TEXTAREA}
                />
              </div>
            );
          default:
            return (
              <Input
                key={field.name}
                id={id}
                name={field.name}
                type={field.type}
                label={field.label}
                required={field.required}
                maxLength={field.maxLength}
                value={String(value)}
                onChange={(event) => set(field.name, event.target.value)}
              />
            );
        }
      })}
      {/* A program fills every field; a person never sees this one. The route drops a post that has it filled. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Website
          <input ref={honeypot} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <button type="submit" disabled={state === "sending"} {...buttonAttributes({ size: "lg", className: "self-start" })}>
        {texts.send}
      </button>
      {state === "failed" && (
        <p role="alert" className="text-sm text-error">
          {failureText(failure, texts, (field) => fields.find((candidate) => candidate.name === field && candidate.type !== "hidden")?.label, locale)}
        </p>
      )}
    </form>
  );
}
