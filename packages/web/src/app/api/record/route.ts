import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/config/env";
import { createRecord } from "@/lib/engine-client";
import { admitFormPost, answer } from "@/lib/form-post";

/** An entity name as the engine spells it, so the name cannot leave the resource path. */
const ENTITY = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_TEXT = 5000;

type Value = string | number | boolean;
interface RecordPost {
  app: string;
  entity: string;
  values: Record<string, Value>;
}

const isValue = (value: unknown): value is Value =>
  typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= MAX_TEXT);

function parse(fields: Record<string, unknown>): RecordPost | null {
  const { app = "", entity, values } = fields;
  if (typeof app !== "string" || typeof entity !== "string" || !ENTITY.test(entity)) return null;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
  const entries = Object.entries(values);
  if (!entries.length || !entries.every(([, value]) => isValue(value))) return null;
  return { app, entity, values: Object.fromEntries(entries) as Record<string, Value> };
}

/**
 * The record form's endpoint: creates one record of the entity the form names, through the public
 * create of the engine that holds it, as Guest. A form that names a tenant app posts to that app's
 * engine (ENGINE_URLS); one that names none posts to the site's own engine, which stamps the site
 * on a site-scoped entity as it does for the contact sheet. The entity's Guest row decides what
 * lands, and the protections are every form's (src/lib/form-post.ts).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const post = await admitFormPost(req);
  if (post instanceof NextResponse) return post;

  const record = parse(post.fields);
  if (!record) return answer(400, { ok: false, message: "Invalid request" });

  const config = getConfig();
  const engineUrl = record.app ? config.engineUrls.get(record.app) : config.engineUrl;
  if (!engineUrl) return answer(503, { ok: false, message: "The form is not configured" });

  try {
    const { status, code } = await createRecord(engineUrl, record.entity, record.values, post.visitor);
    if (status >= 200 && status < 300) return answer(200, { ok: true });
    // The public create answers 403 when the entity grants Guest no create, 404 when the engine
    // holds no such entity, and 400 BAD_REQUEST for a key the Guest row does not let Guest set.
    // Each says the post names an entity or a field Guest may not create, whether a record form
    // names it or the visitor wrote it into the post, and neither case is a value to correct.
    if (status === 403 || status === 404 || (status === 400 && code === "BAD_REQUEST")) {
      console.error(`[digita-web] the engine refused a ${record.entity} create a visitor sent: HTTP ${status} ${code ?? ""}`);
      return answer(403, { ok: false, message: "The form may not create this record" });
    }
    if (status === 400 || status === 413) return answer(400, { ok: false, message: "Invalid request" });
    if (status === 429) return answer(429, { ok: false, message: "Too many requests" });
    throw new Error(`the engine answered HTTP ${status} to the ${record.entity} create`);
  } catch (err) {
    console.error("[digita-web] record create failed:", err instanceof Error ? err.message : err);
    return answer(500, { ok: false, message: "The record could not be sent" });
  }
}
