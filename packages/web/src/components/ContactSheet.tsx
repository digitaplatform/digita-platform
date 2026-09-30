"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, X } from "lucide-react";
import { Drawer, buttonAttributes } from "@digitaplatform/components";
import { closeContactSheet, useContactSheetOpen } from "@/lib/contact-sheet";
import { CONTACT_TOPICS, type ContactTopic } from "@/lib/contact-request";

/** The sheet's texts in the page's locale, built by the server (src/components/chrome-texts.ts):
 *  a client component cannot read the site's texts itself. */
export interface ContactSheetTexts {
  title: string;
  heading: string;
  close: string;
  lede: string;
  book: string;
  /** The divider between the booking link and the form. */
  orWrite: string;
  name: string;
  email: string;
  company: string;
  topic: string;
  message: string;
  messagePlaceholder: string;
  send: string;
  sent: string;
  /** The failure line; the address follows it as a mailto link. */
  failed: string;
  privacyNote: string;
  privacy: string;
  topics: Record<ContactTopic, string>;
}

const FIELD =
  "w-full rounded-input border border-border bg-background px-3 py-3 text-base text-textMain placeholder:text-textMuted focus:border-primary-600 focus:shadow-focus focus:outline-none";
const LABEL = "flex flex-col gap-1.5 text-sm font-semibold text-textMain";

/**
 * The contact sheet: a panel docked to the right edge, opened by any call to action through
 * src/lib/contact-sheet.ts. The kit's Drawer closes it on Escape and on a scrim tap, moves focus
 * into it on open and back to the opener on close.
 */
export function ContactSheet(props: ContactPanelProps) {
  const open = useContactSheetOpen();
  return (
    <Drawer open={open} onClose={closeContactSheet} label={props.texts.title} side="right">
      <ContactPanel {...props} />
    </Drawer>
  );
}

interface ContactPanelProps {
  locale: string;
  texts: ContactSheetTexts;
  contactEmail: string;
  bookingUrl?: string;
  /** The privacy page in the visitor's locale. */
  privacyHref: string;
  /** When the server rendered the page, in its clock. The sheet sends it back unchanged, so the
   *  route's fill-time check measures a person's time from the server's render, not from the
   *  browser's clock. A program that sends a number of its own passes the check. */
  renderedAt: number;
}

/** Mounted on every open, so the form state starts fresh each time. */
function ContactPanel({ locale, texts, contactEmail, bookingUrl, privacyHref, renderedAt }: ContactPanelProps) {
  const [state, setState] = useState<"editing" | "sending" | "sent" | "failed">("editing");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, rendered_at: renderedAt, locale, page: window.location.pathname }),
      });
      setState(res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <aside className="flex h-full w-screen max-w-lg flex-col gap-6 overflow-y-auto border-l border-border bg-surface px-6 py-8 md:px-10 md:py-10">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-textMuted">{texts.title}</p>
          <h2 className="text-balance font-display text-3xl font-semibold tracking-tight text-textMain md:text-4xl">{texts.heading}</h2>
        </div>
        <button
          type="button"
          aria-label={texts.close}
          onClick={closeContactSheet}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-btn border border-border text-textMuted hover:text-textMain focus-visible:shadow-focus focus-visible:outline-none"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {state === "sent" ? (
        <p role="status" className="text-pretty text-lg leading-relaxed text-textMain">
          {texts.sent}
        </p>
      ) : (
        <>
          <p className="text-pretty leading-relaxed text-textMuted">{texts.lede}</p>

          {bookingUrl && (
            <>
              <a
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded-card border border-primary-600 bg-subtle px-4 py-4 font-semibold text-textMain hover:bg-bgHover focus-visible:shadow-focus focus-visible:outline-none"
              >
                <span className="flex items-center gap-3">
                  <CalendarDays className="h-5 w-5 text-primary-600" aria-hidden="true" />
                  {texts.book}
                </span>
                <ArrowRight className="h-4 w-4 text-primary-600" aria-hidden="true" />
              </a>
              <div className="flex items-center gap-3 text-xs text-textMuted">
                <span className="h-px flex-1 bg-border" />
                {texts.orWrite}
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={LABEL}>
                {texts.name}
                <input name="name" type="text" required maxLength={200} autoComplete="name" className={FIELD} />
              </label>
              <label className={LABEL}>
                {texts.email}
                <input name="email" type="email" required maxLength={254} autoComplete="email" className={FIELD} />
              </label>
              <label className={LABEL}>
                {texts.company}
                <input name="company" type="text" maxLength={200} autoComplete="organization" className={FIELD} />
              </label>
              <label className={LABEL}>
                {texts.topic}
                <select name="topic" defaultValue="contact" className={FIELD}>
                  {CONTACT_TOPICS.map((topic) => (
                    <option key={topic} value={topic}>
                      {texts.topics[topic]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={LABEL}>
              {texts.message}
              <textarea name="message" required maxLength={5000} rows={4} placeholder={texts.messagePlaceholder} className={`${FIELD} resize-none`} />
            </label>
            {/* A program fills every field; a person never sees this one. The route drops a request that has it filled. */}
            <div aria-hidden="true" className="sr-only">
              <label>
                Website
                <input name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
              </label>
            </div>
            <button type="submit" disabled={state === "sending"} {...buttonAttributes({ size: "lg", className: "mt-1 w-full" })}>
              {texts.send}
            </button>
            {state === "failed" && (
              <p role="alert" className="text-sm text-error">
                {texts.failed}{" "}
                <a href={`mailto:${contactEmail}`} className="underline">
                  {contactEmail}
                </a>
                .
              </p>
            )}
            <p className="text-xs leading-relaxed text-textMuted">
              {texts.privacyNote}{" "}
              <a href={privacyHref} className="underline hover:text-textMain">
                {texts.privacy}
              </a>
            </p>
          </form>
        </>
      )}

      <a href={`mailto:${contactEmail}`} className="mt-auto text-sm text-textMuted hover:text-textMain">
        {contactEmail}
      </a>
    </aside>
  );
}
