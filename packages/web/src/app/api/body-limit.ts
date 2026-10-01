import type { NextRequest, NextResponse } from "next/server";
import { answer } from "@/lib/form-post";

/** The most bytes a form post may carry. The engine takes 16 kB of a public create, so a post it
 *  would take always fits; Next alone lets a body of 10 MB reach a route, and the route would
 *  parse all of it. */
const MAX_BODY_BYTES = 32 * 1024;

const tooLarge = (): NextResponse => answer(413, { ok: false, message: "Request too large" });

/**
 * Answers 413 for a post whose body is over the limit, or null when it fits. A declared length
 * decides without reading a byte. A post that declares none, as a chunked one does, is counted as it
 * arrives and on a copy, so the route still parses the original whole and a counted body is never
 * read past the limit.
 */
export async function refuseOversizedBody(req: NextRequest): Promise<NextResponse | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared)) return Number(declared) > MAX_BODY_BYTES ? tooLarge() : null;
  const reader = req.clone().body?.getReader();
  if (!reader) return null;
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return null;
    received += value.byteLength;
    // The copy is left open on purpose: cancelling one branch of a copied stream waits for the other.
    if (received > MAX_BODY_BYTES) return tooLarge();
  }
}
