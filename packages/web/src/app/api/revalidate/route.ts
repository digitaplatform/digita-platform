import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
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
 * On-publish revalidation webhook. The engine app-hook (digitaapps/web) POSTs
 * here with the cache tags affected by a publish. Authenticated by a shared
 * secret so only the engine can purge. Body: `{ tags?: string[], paths?: string[] }`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = getConfig().revalidateSecret;
  if (!secret) {
    // Explicitly OPTIONAL feature — not configured → off (no silent fallback).
    return NextResponse.json({ ok: false, message: "Revalidation not configured" }, { status: 503 });
  }
  // Header-only (a query-string secret leaks into logs/referrers), constant-time.
  const provided = req.headers.get("x-revalidate-secret");
  if (!provided || !secretsMatch(provided, secret)) {
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
