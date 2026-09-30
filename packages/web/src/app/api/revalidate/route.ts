import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { REVALIDATE_SECRET_HEADER } from "@digitaplatform/shared";
import { getConfig } from "@/config/env";
import { timingSafeEqual } from "node:crypto";

/** Constant-time, length-guarded secret comparison (avoids a timing oracle). */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * The cache purge the engine posts after a committed write of an entity a visitor can read, with
 * the tag of that entity. Authenticated by the secret the engine and this server share, so only
 * the engine can purge. Body: `{ tags?: string[], paths?: string[] }`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Header-only (a query-string secret leaks into logs/referrers), constant-time.
  const provided = req.headers.get(REVALIDATE_SECRET_HEADER);
  if (!provided || !secretsMatch(provided, getConfig().revalidateSecret)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  let body: { tags?: unknown; paths?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];

  for (const tag of tags) revalidateTag(tag);
  for (const path of paths) revalidatePath(path);

  return NextResponse.json({ ok: true, revalidated: { tags, paths } });
}
