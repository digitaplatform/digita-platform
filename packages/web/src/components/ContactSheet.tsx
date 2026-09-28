"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, X } from "lucide-react";
import { Drawer, buttonAttributes } from "@digitaplatform/components";
import { closeContactSheet, useContactSheetOpen } from "@/lib/contact-sheet";
import { CONTACT_TOPICS, type ContactTopic } from "@/lib/contact-request";

// The site texts carry no contact keys yet, so the sheet speaks English on every locale.
const TOPIC_LABEL: Record<ContactTopic, string> = { contact: "Contact", trial: "Trial", early_access: "Early access" };
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
    <Drawer open={open} onClose={closeContactSheet} label="Contact" side="right">
      <ContactPanel {...props} />
    </Drawer>
  );
}

interface ContactPanelProps {
  locale: string;
  contactEmail: string;
  bookingUrl?: string;
  /** The privacy page in the visitor's locale. */
  privacyHref: string;
  /** When the server rendered the page, in its clock. Sent back unchanged, so the route's fill-time
   *  check compares the server's clock with itself, never with the browser's. */
  renderedAt: number;
}

/** Mounted on every open, so the form state starts fresh each time. */
function ContactPanel({ locale, contactEmail, bookingUrl, privacyHref, renderedAt }: ContactPanelProps) {
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
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-textMuted">Contact</p>
          <h2 className="text-balance font-display text-3xl font-semibold tracking-tight text-textMain md:text-4xl">Let&apos;s talk.</h2>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={closeContactSheet}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-btn border border-border text-textMuted hover:text-textMain focus-visible:shadow-focus focus-visible:outline-none"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {state === "sent" ? (
        <p role="status" className="text-pretty text-lg leading-relaxed text-textMain">
          Thank you. We reply within one working day.
        </p>
      ) : (
        <>
          <p className="text-pretty leading-relaxed text-textMuted">
            Tell us in two sentences what you want to digitalize. We reply within one working day.
          </p>

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
                  Book a 30-minute call
                </span>
                <ArrowRight className="h-4 w-4 text-primary-600" aria-hidden="true" />
              </a>
              <div className="flex items-center gap-3 text-xs text-textMuted">
                <span className="h-px flex-1 bg-border" />
                or write to us
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={LABEL}>
                Name
                <input name="name" type="text" required maxLength={200} autoComplete="name" className={FIELD} />
              </label>
              <label className={LABEL}>
                Email
                <input name="email" type="email" required maxLength={254} autoComplete="email" className={FIELD} />
              </label>
              <label className={LABEL}>
                Company
                <input name="company" type="text" maxLength={200} autoComplete="organization" className={FIELD} />
              </label>
              <label className={LABEL}>
                Topic
                <select name="topic" defaultValue="contact" className={FIELD}>
                  {CONTACT_TOPICS.map((topic) => (
                    <option key={topic} value={topic}>
                      {TOPIC_LABEL[topic]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={LABEL}>
              Message
              <textarea name="message" required maxLength={5000} rows={4} placeholder="Two sentences are enough." className={`${FIELD} resize-none`} />
            </label>
            {/* A program fills every field; a person never sees this one. The route drops a request that has it filled. */}
            <div aria-hidden="true" className="sr-only">
              <label>
                Website
                <input name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
              </label>
            </div>
            <button type="submit" disabled={state === "sending"} {...buttonAttributes({ size: "lg", className: "mt-1 w-full" })}>
              Send
            </button>
            {state === "failed" && (
              <p role="alert" className="text-sm text-error">
                Sending failed. Please check your details and try again, or write to {contactEmail}.
              </p>
            )}
            <p className="text-xs leading-relaxed text-textMuted">
              We use your details only to answer you.{" "}
              <a href={privacyHref} className="underline hover:text-textMain">
                Privacy
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
