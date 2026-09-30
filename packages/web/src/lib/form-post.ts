import { NextResponse, type NextRequest } from "next/server";
import { FormRateLimit } from "./form-rate-limit";

/** A form sent sooner than this after the server rendered its page was filled by a program. */
const MIN_FILL_MS = 3000;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// One budget per visitor across every form of the site, so a second form doubles no one's sends.
const rateLimit = new FormRateLimit(RATE_LIMIT, RATE_WINDOW_MS);

/** The ingress appends the address it saw as the last x-forwarded-for entry; an earlier entry is
 *  whatever the visitor wrote themselves, so only the last one identifies them. */
function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((entry) => entry.trim()).filter(Boolean);
  return forwarded?.at(-1) || req.headers.get("x-real-ip") || "unknown";
}

export const answer = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

/** Whether the post declares a JSON body. A page of another site can make its visitors' browsers post
 *  plain text or a form encoding without asking this server first; JSON needs this server's consent,
 *  which it never gives, so a form that takes JSON alone takes no post such a page made. */
const isJson = (req: NextRequest): boolean => req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json";

/** A post the protections let through: who sent it, and the fields of its JSON body. */
export interface FormPost {
  visitor: string;
  fields: Record<string, unknown>;
}

/**
 * The protections every public form of the site shares, run before a route reads its own fields.
 * Answers the response that ends the post: 415 for a post that is no JSON, before the visitor's
 * budget counts it, 429 past that budget, 400 for a body that is no JSON object or carries no render
 * time, and a success that does nothing for a filled honeypot field (`website`) or a post that came
 * under 3 seconds after the render time it carries, so a program learns nothing from it.
 */
export async function admitFormPost(req: NextRequest): Promise<FormPost | NextResponse> {
  if (!isJson(req)) return answer(415, { ok: false, message: "Unsupported media type" });
  const now = Date.now();
  const visitor = clientAddress(req);
  rateLimit.recordSend(visitor);
  if (rateLimit.isOverLimit(visitor)) return answer(429, { ok: false, message: "Too many requests" });

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
  if (typeof fields.rendered_at !== "number" || !Number.isFinite(fields.rendered_at)) return answer(400, { ok: false, message: "Invalid request" });
  return { visitor, fields };
}
