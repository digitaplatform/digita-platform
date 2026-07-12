import type { FastifyRequest, FastifyReply } from "fastify";
import { SYSTEM_ROLES } from "@digitaplatform/shared";

/**
 * Administrator gate for privileged authenticated routes (P-SEC).
 *
 * Extracted from the inline pattern repeated in admin-reseed-router,
 * schema-drift-router and admin-reload-definitions-router. Call at the TOP of a
 * handler and early-return on `false`:
 *
 *   if (!requireAdministrator(request, reply)) return;
 *
 * Applied per-handler (not as a scope hook) because sibling GET readers in the
 * same routers must stay open to any authenticated caller. Sends the same 403
 * body shape the frontend already handles for the existing admin routes.
 */
export function requireAdministrator(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user;
  if (!user || !user.roles?.includes(SYSTEM_ROLES.ADMINISTRATOR)) {
    reply.code(403).send({ success: false, error: { code: "FORBIDDEN" } });
    return false;
  }
  return true;
}
