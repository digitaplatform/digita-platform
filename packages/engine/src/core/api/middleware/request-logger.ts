import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { createLogger } from "../../logging/logger.js";

const log = createLogger("http");

/**
 * Log complete request and response at DEBUG level.
 * At INFO level, log only summary (method, url, status, duration).
 */
export function requestLoggerOnRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  // Store start time
  (request as unknown as Record<string, unknown>)["_startTime"] = process.hrtime.bigint();

  log.debug(
    {
      direction: "REQUEST",
      trace_id: request.traceId,
      method: request.method,
      url: request.url,
      params: request.params,
      query: request.query,
      body: request.body,
      headers: request.headers,
      ip: request.ip,
      user: request.user?.email ?? "anonymous",
      locale: request.locale,
    },
    `${request.method} ${request.url}`,
  );

  done();
}

export function requestLoggerOnResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  const startTime = (request as unknown as Record<string, unknown>)["_startTime"] as bigint;
  const durationMs = startTime ? Number((process.hrtime.bigint() - startTime) / 1_000_000n) : 0;

  log.info(
    {
      trace_id: request.traceId,
      method: request.method,
      url: request.url,
      status_code: reply.statusCode,
      duration_ms: durationMs,
      user: request.user?.email ?? "anonymous",
    },
    `${request.method} ${request.url} → ${reply.statusCode} (${durationMs}ms)`,
  );

  done();
}

/**
 * onSend hook — logs full response body at DEBUG level.
 * Handles string, Buffer, null, and stream payloads gracefully.
 * Use with: app.addHook("onSend", requestLoggerOnSend)
 */
export function requestLoggerOnSend(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  done: (err?: Error | null, payload?: unknown) => void,
): void {
  const MAX_BODY_LOG = 4096;

  let bodyForLog: unknown;
  if (payload === null || payload === undefined) {
    bodyForLog = null;
  } else if (typeof payload === "string") {
    bodyForLog =
      payload.length > MAX_BODY_LOG ? payload.slice(0, MAX_BODY_LOG) + "...(truncated)" : payload;
  } else if (Buffer.isBuffer(payload)) {
    bodyForLog = `<Buffer ${payload.length} bytes>`;
  } else if (typeof payload === "object" && "pipe" in payload) {
    bodyForLog = "<Stream>";
  } else {
    bodyForLog = "<unknown payload type>";
  }

  log.debug(
    {
      direction: "RESPONSE",
      trace_id: request.traceId,
      method: request.method,
      url: request.url,
      status_code: reply.statusCode,
      body: bodyForLog,
      user: request.user?.email ?? "anonymous",
    },
    `RESPONSE ${request.method} ${request.url}`,
  );

  done(null, payload);
}
