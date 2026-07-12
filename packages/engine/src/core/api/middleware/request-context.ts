import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { randomUUID } from "crypto";

/**
 * Assign a unique trace ID to every request.
 */
export function requestContextMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  request.traceId = (request.headers["x-trace-id"] as string) ?? randomUUID().slice(0, 12);
  done();
}
