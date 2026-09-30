import type { NextResponse } from "next/server";

/** How long a visitor over the renderer's own budget of posts waits, at the latest. The budget
 *  counts a visitor's posts over one hour (src/lib/form-post.ts) and counts the ones it refuses
 *  too, so a visitor who stops is admitted again an hour after their last post. */
export const OWN_BUDGET_WAIT_SECONDS = 60 * 60;

/** Puts the wait a visitor is asked to keep into the standard header. An answer with no known wait
 *  is left as it is: a wait nobody knows is not made up. */
export function tellRetryAfter(response: NextResponse, seconds: number | undefined): NextResponse {
  if (seconds !== undefined) response.headers.set("Retry-After", String(seconds));
  return response;
}
