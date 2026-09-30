import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/config/env";
import { createRecord, getSite } from "@/lib/engine-client";
import { CONTACT_TOPICS, type ContactRequest } from "@/lib/contact-request";
import { admitFormPost, answer } from "@/lib/form-post";
import { refuseOversizedBody } from "@/app/api/body-limit";

// A line field goes into a mail subject or header, so a control character is refused, not stripped.
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max && !CONTROL.test(text) ? text : null;
}

function parse(body: Record<string, unknown>, locales: string[]): ContactRequest | null {
  const name = line(body.name, 200);
  const email = line(body.email, 254);
  const company = body.company === undefined || body.company === "" ? "" : line(body.company, 200);
  const topic = CONTACT_TOPICS.find((t) => t === body.topic);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const locale = line(body.locale, 10);
  const page = line(body.page, 500);
  if (!name || !email || !EMAIL.test(email) || company === null || !topic) return null;
  if (!message || message.length > 5000 || !locale || !locales.includes(locale) || !page?.startsWith("/")) return null;
  return { name, email, company, topic, message, locale, page };
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
  if (post instanceof NextResponse) return post;

  const request = parse(post.fields, config.locales);
  if (!request) return answer(400, { ok: false, message: "Invalid request" });

  try {
    const site = await getSite();
    if (!site?.contact_email) return answer(503, { ok: false, message: "Contact is not configured" });

    // The engine stamps the site from its own SITE_ID and refuses a Link in the body.
    const { status } = await createRecord(config.engineUrl, "ContactRequest", request, post.visitor);
    // 403: the engine grants no Guest create on ContactRequest yet, so the sheet offers the address.
    if (status === 403) return answer(503, { ok: false, message: "Contact is not configured" });
    if (status < 200 || status >= 300) throw new Error(`the engine answered HTTP ${status} to the ContactRequest create`);
    return answer(200, { ok: true });
  } catch (err) {
    console.error("[digita-web] contact request failed:", err instanceof Error ? err.message : err);
    return answer(500, { ok: false, message: "The request could not be sent" });
  }
}
