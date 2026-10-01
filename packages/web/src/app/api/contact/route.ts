import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/config/env";
import { createRecord, getSite } from "@/lib/engine-client";
import { CONTACT_TOPICS, type ContactRequest } from "@/lib/contact-request";
import { admitFormPost, answer } from "@/lib/form-post";
import { refuseOversizedBody } from "@/app/api/body-limit";
import { OWN_BUDGET_WAIT_SECONDS, tellRetryAfter } from "@/app/api/retry-after";

// A line field goes into a mail subject or header, so a control character is refused, not stripped.
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max && !CONTROL.test(text) ? text : null;
}

/** The request, or the first field the route refuses, in the order of the form. */
function parse(body: Record<string, unknown>, locales: string[]): { request: ContactRequest } | { field: string } {
  const name = line(body.name, 200);
  const email = line(body.email, 254);
  const company = body.company === undefined || body.company === "" ? "" : line(body.company, 200);
  const topic = CONTACT_TOPICS.find((t) => t === body.topic);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const locale = line(body.locale, 10);
  const page = line(body.page, 500);
  if (!name) return { field: "name" };
  if (!email || !EMAIL.test(email)) return { field: "email" };
  if (company === null) return { field: "company" };
  if (!topic) return { field: "topic" };
  if (!message || message.length > 5000) return { field: "message" };
  if (!locale || !locales.includes(locale)) return { field: "locale" };
  if (!page?.startsWith("/")) return { field: "page" };
  return { request: { name, email, company, topic, message, locale, page } };
}

/**
 * The contact sheet's endpoint: stores the request as a ContactRequest on the engine, whose web
 * app mails the site's contact address on insert. The protections are every form's
 * (src/lib/form-post.ts): a program that fills the honeypot or sends too fast is answered like a
 * success and reaches nothing.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  const oversized = await refuseOversizedBody(req);
  if (oversized) return oversized;
  const post = await admitFormPost(req);
  if (post instanceof NextResponse) return tellRetryAfter(post, post.status === 429 ? OWN_BUDGET_WAIT_SECONDS : undefined);

  const parsed = parse(post.fields, config.locales);
  if (!("request" in parsed)) return answer(400, { ok: false, message: "Invalid request", field: parsed.field });
  const { request } = parsed;

  try {
    const site = await getSite();
    if (!site?.contact_email) return answer(503, { ok: false, message: "Contact is not configured" });

    // The engine stamps the site from its own SITE_ID and refuses a Link in the body.
    const { status, code, field, retryAfter } = await createRecord(config.engineUrl, "ContactRequest", request, post.visitor);
    if (status >= 200 && status < 300) return answer(200, { ok: true });
    // 403: the engine grants no Guest create on ContactRequest yet, so the sheet offers the address.
    // A 400 BAD_REQUEST names a key the route sends and the Guest row does not let Guest set: the
    // site is not set up for the form either, and nothing the visitor typed is wrong.
    if (status === 403 || (status === 400 && code === "BAD_REQUEST")) {
      if (status === 400) console.error(`[digita-web] the engine refused a ContactRequest key: ${field ?? ""}`);
      return answer(503, { ok: false, message: "Contact is not configured" });
    }
    // A value the engine refuses is the visitor's to correct, and the engine's own budget of creates
    // names its wait: the sheet tells either as it tells the route's own.
    if (status === 400) return answer(400, { ok: false, message: "Invalid request", ...(field === undefined ? {} : { field }) });
    if (status === 429) return tellRetryAfter(answer(429, { ok: false, message: "Too many requests" }), retryAfter);
    throw new Error(`the engine answered HTTP ${status} to the ContactRequest create`);
  } catch (err) {
    console.error("[digita-web] contact request failed:", err instanceof Error ? err.message : err);
    return answer(500, { ok: false, message: "The request could not be sent" });
  }
}
