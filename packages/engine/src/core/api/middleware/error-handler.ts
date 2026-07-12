import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { ApiResponse, DeclaredClientError } from "@digitaplatform/shared";
import {
  MongoServerError,
  MongoNetworkError,
  MongoNetworkTimeoutError,
  MongoServerSelectionError,
  MongoWriteConcernError,
} from "mongodb";
import {
  NotFoundError,
  ValidationFailedError,
  ConcurrentModificationError,
  DeleteBlockedError,
  LinkTargetCancelledError,
  TimeSeriesImmutableError,
} from "../../document/document-service.js";
import { NamingSeriesFieldEmptyError } from "../../document/naming-service.js";
import { IllegalTransitionError } from "../../workflow/workflow-engine.js";
import {
  PeriodClosedError,
  NoMatchingPeriodError,
  AmbiguousPeriodError,
  DateOutsidePeriodError,
} from "../../period/period-close-validator.js";
import { PermissionDeniedError } from "../../permissions/permission-checker.js";
import { DocStatusError } from "../../document/docstatus-engine.js";
import { ViewNotFoundError, BadRequestError } from "../../view/view-engine.js";
import { UnknownDoctypeError } from "../../entity/entity-registry.js";
import { FilterFieldNotAllowedError } from "../../database/filter-builder.js";
import { FieldValueError } from "../../entity/field-types.js";
import { createLogger } from "../../logging/logger.js";

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
      url: request.url,
      user: request.user?.email,
    },
    "Request error",
  );

  if (error instanceof ViewNotFoundError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 404,
      data: null,
      messages: [{ text: error.message, type: "error", show: true }],
      error: { code: "VIEW_NOT_FOUND", detail: error.message, trace_id: traceId },
    };
    reply.code(404).send(response);
    return;
  }

  if (error instanceof BadRequestError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [{ text: error.message, type: "error", show: true }],
      error: { code: "BAD_REQUEST", detail: error.detail, trace_id: traceId },
    };
    reply.code(400).send(response);
    return;
  }

  if (error instanceof FilterFieldNotAllowedError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [{ text: "filter_field_not_allowed", type: "error", show: true, params: { field: error.field } }],
      error: { code: "FILTER_FIELD_NOT_ALLOWED", detail: error.message, trace_id: traceId },
    };
    reply.code(400).send(response);
    return;
  }

  // A field-type handler (e.g. a date filter value that isn't a valid date) rejected
  // a value. Normally serializeFields rewraps this into a ValidationFailedError on
  // the write path; on the READ/filter path it surfaces directly — map it to 400 so
  // an uncoercible filter fails LOUD (never a silent 0-row match).
  if (error instanceof FieldValueError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [
        {
          text: error.message_key,
          type: "error",
          show: true,
          params: { field: error.field, ...(error.params ?? {}) },
        },
      ],
      error: { code: "FIELD_VALUE_INVALID", detail: error.message, trace_id: traceId },
    };
    reply.code(400).send(response);
    return;
  }

  if (error instanceof NotFoundError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 404,
      data: null,
      messages: [{ text: error.message, type: "error", show: true }],
      error: { code: "NOT_FOUND", detail: error.message, trace_id: traceId },
    };
    reply.code(404).send(response);
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

  if (error instanceof ValidationFailedError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      // `path` carries the offending fieldname so the frontend can bind the
      // error to the exact control; `params` lets the i18n hook interpolate the
      // field label into the message text. Both were previously dropped.
      messages: error.errors.map((e) => ({
        text: e.message_key,
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

  if (error instanceof PermissionDeniedError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 403,
      data: null,
      messages: [{ text: error.message, type: "error", show: true }],
      error: { code: "PERMISSION_DENIED", detail: error.message, trace_id: traceId },
    };
    reply.code(403).send(response);
    return;
  }

  if (error instanceof ConcurrentModificationError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 409,
      data: null,
      messages: [{ text: "document_modified", type: "error", show: true }],
      error: { code: "CONCURRENT_MODIFICATION", detail: error.message, trace_id: traceId },
    };
    reply.code(409).send(response);
    return;
  }

  if (error instanceof IllegalTransitionError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 409,
      data: null,
      messages: [{ text: error.message, type: "error", show: true }],
      error: { code: "ILLEGAL_TRANSITION", detail: error.message, trace_id: traceId },
    };
    reply.code(409).send(response);
    return;
  }

  if (error instanceof TimeSeriesImmutableError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [{ text: error.message, type: "error", show: true }],
      error: { code: "TIME_SERIES_IMMUTABLE", detail: error.message, trace_id: traceId },
    };
    reply.code(400).send(response);
    return;
  }

  if (error instanceof PeriodClosedError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 409,
      data: null,
      messages: [{ text: "period_closed", type: "error", show: true }],
      error: { code: "PERIOD_CLOSED", detail: error.message, trace_id: traceId },
    };
    reply.code(409).send(response);
    return;
  }

  if (error instanceof NoMatchingPeriodError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [{ text: "period_not_found_for_date", type: "error", show: true }],
      error: { code: "PERIOD_NOT_FOUND", detail: error.message, trace_id: traceId },
    };
    reply.code(400).send(response);
    return;
  }

  if (error instanceof AmbiguousPeriodError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [{ text: "period_ambiguous_for_date", type: "error", show: true }],
      error: { code: "PERIOD_AMBIGUOUS", detail: error.message, trace_id: traceId },
    };
    reply.code(400).send(response);
    return;
  }

  if (error instanceof DateOutsidePeriodError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [{ text: "date_outside_period", type: "error", show: true }],
      error: { code: "DATE_OUTSIDE_PERIOD", detail: error.message, trace_id: traceId },
    };
    reply.code(400).send(response);
    return;
  }

  if (error instanceof NamingSeriesFieldEmptyError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [
        {
          text: "naming_field_required",
          type: "error",
          show: true,
          params: { field: error.field },
        },
      ],
      error: {
        code: "NAMING_FIELD_REQUIRED",
        detail: error.message,
        field: error.field,
        trace_id: traceId,
      },
    };
    reply.code(400).send(response);
    return;
  }

  if (error instanceof DeleteBlockedError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 409,
      data: null,
      messages: [{ text: error.message, type: "error", show: true }],
      error: { code: "DELETE_BLOCKED", detail: error.message, trace_id: traceId },
    };
    reply.code(409).send(response);
    return;
  }

  // A submit that would forward into a concurrently-cancelled link target (the
  // write-skew guard's "cancel committed first" branch) — 409, like the other
  // lifecycle-conflict errors.
  if (error instanceof LinkTargetCancelledError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 409,
      data: null,
      messages: [
        {
          text: "link_target_cancelled",
          type: "error",
          show: true,
          params: {
            fieldname: error.fieldname,
            target: error.targetEntity,
            name: error.targetName,
          },
        },
      ],
      error: { code: "LINK_TARGET_CANCELLED", detail: error.message, trace_id: traceId },
    };
    reply.code(409).send(response);
    return;
  }

  if (error instanceof DocStatusError) {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 400,
      data: null,
      messages: [{ text: error.messageKey, type: "error", show: true }],
      error: { code: "DOCSTATUS_ERROR", detail: error.messageKey, trace_id: traceId },
    };
    reply.code(400).send(response);
    return;
  }

  if (error.message === "login_failed") {
    const response: ApiResponse<null> = {
      success: false,
      status_code: 401,
      data: null,
      messages: [{ text: "login_failed", type: "error", show: true }],
      error: { code: "LOGIN_FAILED", detail: "Invalid credentials", trace_id: traceId },
    };
    reply.code(401).send(response);
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
  const declared: unknown = (error as { statusCode?: unknown }).statusCode;
  if (
    typeof declared === "number" &&
    Number.isInteger(declared) &&
    declared >= 400 &&
    declared <= 499
  ) {
    const e = error as Error & Partial<DeclaredClientError>;
    const response: ApiResponse<null> = {
      success: false,
      status_code: declared,
      data: null,
      messages: [
        {
          // Raw text passes the i18n preSerialization hook verbatim (unknown key
          // → identity), so either a message key or a plain sentence surfaces.
          text: e.messageKey ?? error.message,
          type: "error",
          show: true,
          ...(e.field ? { path: e.field } : {}),
          ...(e.messageKey && e.params ? { params: e.params } : {}),
        },
      ],
      error: {
        code: e.code || "BUSINESS_RULE_VIOLATION",
        // The raw Error.message is preserved for diagnostics even when a
        // messageKey drives the shown text.
        detail: error.message,
        trace_id: traceId,
        ...(e.field ? { field: e.field } : {}),
      },
    };
    reply.code(declared).send(response);
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
