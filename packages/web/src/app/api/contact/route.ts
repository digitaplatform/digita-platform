import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/config/env";
import { createContactRequest, getSite } from "@/lib/engine-client";
import { CONTACT_TOPICS, type ContactRequest } from "@/lib/contact-request";

/** A form sent sooner than this after the server rendered its page was filled by a program. */
const MIN_FILL_MS = 3000;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// ponytail: in-memory, per process: a restart forgets it and each replica counts on its own, so
// the real ceiling is 5 per hour per replica. Move it to a shared store (Redis) once the site
// runs more than one replica or sees real abuse.
const sentAt = new Map<string, number[]>();

/** Counts this request against its address and answers whether the address is over the limit. */
function isRateLimited(address: string, now: number): boolean {
  for (const [key, times] of sentAt) {
    const recent = times.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length) sentAt.set(key, recent);
    else sentAt.delete(key);
  }
  const times = sentAt.get(address) ?? [];
  times.push(now);
  sentAt.set(address, times);
  return times.length > RATE_LIMIT;
}

/** The ingress appends the address it saw as the last x-forwarded-for entry; an earlier entry is
 *  whatever the visitor wrote themselves, so only the last one identifies them. */
function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((entry) => entry.trim()).filter(Boolean);
  return forwarded?.at(-1) || req.headers.get("x-real-ip") || "unknown";
}

const answer = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

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
  if (typeof body.rendered_at !== "number" || !Number.isFinite(body.rendered_at)) return null;
  return { name, email, company, topic, message, locale, page };
}

/**
 * The contact sheet's endpoint: stores the request as a ContactRequest on the engine, whose web
 * app mails the site's contact address on insert. A filled honeypot field (`website`) or a form
 * sent under 3 seconds after the server rendered its page is answered like a success and does
 * nothing, so a program learns nothing from it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  const now = Date.now();
  const visitor = clientAddress(req);
  if (isRateLimited(visitor, now)) return answer(429, { ok: false, message: "Too many requests" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return answer(400, { ok: false, message: "Invalid request" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return answer(400, { ok: false, message: "Invalid request" });
  const fields = body as Record<string, unknown>;

  const honeypotFilled = typeof fields.website === "string" && fields.website !== "";
  const filledTooFast = typeof fields.rendered_at === "number" && now - fields.rendered_at < MIN_FILL_MS;
  if (honeypotFilled || filledTooFast) return answer(200, { ok: true });

  const request = parse(fields, config.locales);
  if (!request) return answer(400, { ok: false, message: "Invalid request" });

  try {
    const site = await getSite();
    if (!site?.contact_email) return answer(503, { ok: false, message: "Contact is not configured" });

    // The engine stamps the site from its own SITE_ID and refuses a Link in the body.
    const status = await createContactRequest(request, visitor);
    // 403: the engine grants no Guest create on ContactRequest yet, so the sheet offers the address.
    if (status === 403) return answer(503, { ok: false, message: "Contact is not configured" });
    if (status < 200 || status >= 300) throw new Error(`the engine answered HTTP ${status} to the ContactRequest create`);
    return answer(200, { ok: true });
  } catch (err) {
    console.error("[digita-web] contact request failed:", err instanceof Error ? err.message : err);
    return answer(500, { ok: false, message: "The request could not be sent" });
  }
}
