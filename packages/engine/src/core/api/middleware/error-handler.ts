import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { ApiResponse } from "@digitaplatform/shared";
import {
  MongoServerError,
  MongoNetworkError,
  MongoNetworkTimeoutError,
  MongoServerSelectionError,
  MongoWriteConcernError,
} from "mongodb";
import { ValidationFailedError } from "../../document/document-service.js";
import { UnknownDoctypeError } from "../../entity/entity-registry.js";
import { EngineError } from "../../errors/engine-error.js";
import { declaredClientMessage, findDeclaredClientError } from "../../errors/declared-client-error.js";
import { englishText } from "../../../i18n.js";
import { createLogger } from "../../logging/logger.js";
import { urlPath } from "../../logging/url-path.js";

const log = createLogger("error-handler");

export function globalErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const traceId = request.traceId ?? "";

  // Log the full error at debug level
  log.debug(
    {
      trace_id: traceId,
      err: error,
      method: request.method,
      url: urlPath(request.url),
      user: request.user?.email,
    },
    "Request error",
  );

  // Every EngineError answers alike: its code with its params as the message, which the response
  // hook translates into the requester's language, and its status. The log reads it in English; a
  // 5xx is the engine's or an author's fault, so it is logged as an error with its stack.
  if (error instanceof EngineError) {
    const entry = { trace_id: traceId, code: error.code, params: error.params, text: englishText(error.code, error.params) };
    if (error.status >= 500) log.error({ ...entry, err: error }, "Request failed");
    else log.debug(entry, "Request refused");
    // A refused save answers with one message per field it refuses.
    if (error instanceof ValidationFailedError) {
      const response: ApiResponse<null> = {
        success: false,
        status_code: 400,
        data: null,
        // `path` carries the offending fieldname so the frontend can bind the
        // error to the exact control; `params` lets the i18n hook interpolate the
        // field label into the message text.
        messages: error.errors.map((e) => ({
          text: e.code,
          type: "error" as const,
          show: true,
          ...(e.field ? { path: e.field } : {}),
          ...(e.params ? { params: e.params } : {}),
        })),
        error: {
          code: "VALIDATION_ERROR",
          detail: `${error.errors.length} validation error(s)`,
          trace_id: traceId,
          // Single-field failure → also expose it on the error envelope.
          ...(error.errors.length === 1 && error.errors[0]?.field
            ? { field: error.errors[0].field }
            : {}),
        },
      };
      reply.code(400).send(response);
      return;
    }
    const response: ApiResponse<null> = {
      success: false,
      status_code: error.status,
      data: null,
      messages: [{ text: error.code, type: "error", show: true, params: error.params, ...(error.field ? { path: error.field } : {}) }],
      error: { code: error.responseCode, detail: error.code, trace_id: traceId, ...(error.field ? { field: error.field } : {}) },
    };
    reply.code(error.status).send(response);
    return;
  }

  // Unknown doctype — EntityRegistry.get throws a typed UnknownDoctypeError
  // carrying the requested name + closest registered match. Surface both so the
  // 404 is self-diagnosing ("…\"userMenu\" — did you mean \"UserMenu\"?") — the
  // overwhelming cause is a casing/plural mismatch, not a removed entity. 404
  // (not 500) so removed/never-existing doctypes read as "not found".
  if (error instanceof UnknownDoctypeError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 404,
      data: null,
      messages: [
        {
          text: error.suggestion ? "entity_not_found_suggestion" : "entity_not_found",
          type: "error",
          show: true,
          params: { doctype: error.doctype, did_you_mean: error.suggestion ?? "" },
        },
      ],
      error: {
        code: "UNKNOWN_DOCTYPE",
        detail: error.isCasing
          ? `casing mismatch: did you mean "${error.suggestion}"?`
          : error.suggestion
            ? `unknown doctype "${error.doctype}"; closest match "${error.suggestion}"`
            : `doctype "${error.doctype}" is not registered (check APP_DIRS / domain loaded)`,
        trace_id: traceId,
      },
    };
    reply.code(404).send(response);
    return;
  }

  // Rate limit error
  if ("statusCode" in error && (error as FastifyError).statusCode === 429) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 429,
      data: null,
      messages: [{ text: "rate_limited", type: "error", show: true }],
      error: { code: "RATE_LIMITED", detail: "Too many requests", trace_id: traceId },
    };
    reply.code(429).send(response);
    return;
  }

  // ─── Declared client error (business-rule hook 4xx) ──────────────────
  // A thrower DECLARES a client error by attaching an explicit integer 4xx
  // `statusCode` to the Error (Fastify's convention; see the shared
  // `DeclaredClientError` type). Business-rule guards in app hooks (over-
  // delivery, credit-limit, blocked-customer, allocation-sum, …) do
  // `throw Object.assign(new Error(msg), { statusCode: 422 })` and EXPECT the
  // reason to reach the client, not be swallowed by the generic 500 below.
  // Honor any 400–499 and surface the message. Fastify core 4xx (malformed JSON
  // 400, 413 body-too-large, 415) get correctly typed here too. MUST stay AFTER
  // the 429 branch so rate-limits keep their dedicated RATE_LIMITED code.
  // Non-integer / string / out-of-range statusCode falls through to the 500
  // below (TypeError / Mongo / fetch errors never carry a 4xx one — no silent
  // fallback keeps genuine server faults loud). Not logged as an error: it's a
  // client error and the debug log above already captured it.
  const declared = findDeclaredClientError(error);
  if (declared) {
    const { text, params, field } = declaredClientMessage(declared);
    const response: ApiResponse<null> = {
      success: false,
      status_code: declared.statusCode,
      data: null,
      messages: [
        {
          text,
          type: "error",
          show: true,
          ...(field ? { path: field } : {}),
          ...(params ? { params } : {}),
        },
      ],
      error: {
        code: declared.code || "BUSINESS_RULE_VIOLATION",
        // The raw Error.message is preserved for diagnostics even when a
        // messageKey drives the shown text.
        detail: error.message,
        trace_id: traceId,
        ...(field ? { field } : {}),
      },
    };
    reply.code(declared.statusCode).send(response);
    return;
  }

  // ─── MongoDB Errors ──────────────────────────────────
  // Note: check order matters — subclasses before parent classes
  // MongoWriteConcernError extends MongoServerError, so must come first
  // MongoNetworkTimeoutError extends MongoNetworkError, so must come first

  if (error instanceof MongoWriteConcernError) {
    log.error({ trace_id: traceId, err: error }, "MongoDB write concern error");
    const response: ApiResponse<null> = {
      success: false,
      status_code: 500,
      data: null,
      messages: [{ text: "database_write_error", type: "error", show: true }],
      error: {
        code: "DATABASE_WRITE_ERROR",
        detail: "Database write concern not satisfied",
        trace_id: traceId,
      },
    };
    reply.code(500).send(response);
    return;
  }

  if (error instanceof MongoServerError) {
    // Duplicate key (E11000)
    if (error.code === 11000) {
      const keyPattern = error.keyPattern ?? {};
      const field = Object.keys(keyPattern)[0] ?? "unknown";
      const hasField = field !== "unknown";
      const response: ApiResponse<null> = {
        success: false,
        status_code: 409,
        data: null,
        messages: [
          {
            text: `duplicate_key`,
            type: "error",
            show: true,
            // Bind to the conflicting field + give the i18n hook the field name.
            ...(hasField ? { path: field } : {}),
            params: { field },
          },
        ],
        error: {
          code: "DUPLICATE_KEY",
          detail: `Duplicate value for field: ${field}`,
          trace_id: traceId,
          ...(hasField ? { field } : {}),
        },
      };
      reply.code(409).send(response);
      return;
    }

    // Other MongoDB server errors — log the driver's errmsg/message so the
    // failure is diagnosable without flipping the whole service to debug level.
    log.error(
      {
        trace_id: traceId,
        code: error.code,
        codeName: error.codeName,
        errmsg: error.errmsg ?? error.message,
      },
      "MongoDB server error",
    );
    const response: ApiResponse<null> = {
      success: false,
      status_code: 500,
      data: null,
      messages: [{ text: "database_error", type: "error", show: true }],
      error: {
        code: "DATABASE_ERROR",
        detail: `Database error: ${error.codeName ?? error.code}`,
        trace_id: traceId,
      },
    };
    reply.code(500).send(response);
    return;
  }

  if (error instanceof MongoNetworkTimeoutError || error instanceof MongoServerSelectionError) {
    log.error({ trace_id: traceId, err: error }, "MongoDB connection timeout");
    const response: ApiResponse<null> = {
      success: false,
      status_code: 503,
      data: null,
      messages: [{ text: "database_unavailable", type: "error", show: true }],
      error: {
        code: "DATABASE_UNAVAILABLE",
        detail: "Database connection timed out",
        trace_id: traceId,
      },
    };
    reply.code(503).send(response);
    return;
  }

  if (error instanceof MongoNetworkError) {
    log.error({ trace_id: traceId, err: error }, "MongoDB network error");
    const response: ApiResponse<null> = {
      success: false,
      status_code: 503,
      data: null,
      messages: [{ text: "database_unavailable", type: "error", show: true }],
      error: {
        code: "DATABASE_UNAVAILABLE",
        detail: "Database connection failed",
        trace_id: traceId,
      },
    };
    reply.code(503).send(response);
    return;
  }

  // Unknown error
  log.error({ trace_id: traceId, err: error }, "Unhandled error");

  const response: ApiResponse<null> = {
    success: false,
    status_code: 500,
    data: null,
    messages: [{ text: "internal_error", type: "error", show: true }],
    error: { code: "INTERNAL_ERROR", detail: "An unexpected error occurred", trace_id: traceId },
  };
  reply.code(500).send(response);
}
