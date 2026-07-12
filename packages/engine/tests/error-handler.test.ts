import { describe, it, expect, vi } from "vitest";

// Mock the logger so env.ts is never evaluated during tests (it requires MONGODB_URI)
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
// document-service now imports env directly (permission-scope gate); stub it so
// the import graph doesn't demand MONGODB_URI.
vi.mock("../src/core/config/env.js", () => ({
  env: { PERMISSION_SCOPE_ENABLED: false },
}));

import { globalErrorHandler } from "../src/core/api/middleware/error-handler.js";
import { NotFoundError, ValidationFailedError, ConcurrentModificationError, DeleteBlockedError } from "../src/core/document/document-service.js";
import { PermissionDeniedError } from "../src/core/permissions/permission-checker.js";
import { DocStatusError } from "../src/core/document/docstatus-engine.js";
import {
  MongoServerError,
  MongoNetworkError,
  MongoNetworkTimeoutError,
  MongoServerSelectionError,
  MongoWriteConcernError,
} from "mongodb";

// ─── Helpers ───────────────────────────────────────────────────────────────

function mockRequest(overrides = {}): any {
  return {
    traceId: "test-trace-id",
    method: "GET",
    url: "/test",
    user: { email: "test@test.com" },
    ...overrides,
  };
}

function mockReply(): any {
  const reply: any = { statusCode: 200, sentData: null };
  reply.code = (code: number) => { reply.statusCode = code; return reply; };
  reply.send = (data: any) => { reply.sentData = data; return reply; };
  return reply;
}

/**
 * Create a MongoDB error instance via Object.create so the instanceof check
 * passes without invoking an internal-only constructor with complex arguments
 * (e.g. TopologyDescription for MongoServerSelectionError).
 */
function makeMongoError<T extends object>(cls: new (...args: any[]) => T, props: Partial<T> & Record<string, any> = {}): T {
  const instance = Object.create(cls.prototype) as T;
  Object.assign(instance, { message: "mongo error", ...props });
  return instance;
}

// ─── NotFoundError ─────────────────────────────────────────────────────────

describe("globalErrorHandler – NotFoundError", () => {
  it("returns 404 with NOT_FOUND code", () => {
    const error = new NotFoundError("Invoice", "INV-001");
    const req = mockRequest();
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.statusCode).toBe(404);
    expect(reply.sentData.success).toBe(false);
    expect(reply.sentData.status_code).toBe(404);
    expect(reply.sentData.error.code).toBe("NOT_FOUND");
    expect(reply.sentData.data).toBeNull();
  });

  it("passes the trace_id through", () => {
    const error = new NotFoundError("Customer", "CUST-1");
    const req = mockRequest({ traceId: "trace-abc" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-abc");
  });

  it("puts the error message in messages[]", () => {
    const error = new NotFoundError("Product", "PROD-99");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages).toHaveLength(1);
    expect(reply.sentData.messages[0].text).toBe(error.message);
    expect(reply.sentData.messages[0].type).toBe("error");
    expect(reply.sentData.messages[0].show).toBe(true);
  });
});

// ─── ValidationFailedError ─────────────────────────────────────────────────

describe("globalErrorHandler – ValidationFailedError", () => {
  it("returns 400 with VALIDATION_ERROR code", () => {
    const errors = [
      { field: "email", message_key: "field_required" },
      { field: "name", message_key: "field_too_short" },
    ];
    const error = new ValidationFailedError("user", errors);
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.sentData.error.code).toBe("VALIDATION_ERROR");
  });

  it("maps each validation error to a message entry", () => {
    const errors = [
      { field: "email", message_key: "field_required" },
      { field: "name", message_key: "field_too_short" },
    ];
    const error = new ValidationFailedError("user", errors);
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages).toHaveLength(2);
    expect(reply.sentData.messages[0].text).toBe("field_required");
    expect(reply.sentData.messages[1].text).toBe("field_too_short");
    expect(reply.sentData.messages[0].type).toBe("error");
  });

  it("puts validation count in detail", () => {
    const errors = [{ field: "email", message_key: "field_required" }];
    const error = new ValidationFailedError("user", errors);
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.error.detail).toContain("1 validation error");
  });

  it("passes the trace_id through", () => {
    const error = new ValidationFailedError("user", [{ field: "x", message_key: "required" }]);
    const req = mockRequest({ traceId: "trace-val" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-val");
  });

  it("binds each message to its field via path (frontend field-binding)", () => {
    const errors = [
      { field: "email", message_key: "field_required" },
      { field: "name", message_key: "field_too_short", params: { field: "Name" } },
    ];
    const error = new ValidationFailedError("user", errors);
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages[0].path).toBe("email");
    expect(reply.sentData.messages[1].path).toBe("name");
    // params survive for the i18n interpolation hook
    expect(reply.sentData.messages[1].params).toEqual({ field: "Name" });
  });

  it("exposes the field on the error envelope for a single-field failure", () => {
    const error = new ValidationFailedError("user", [{ field: "email", message_key: "field_required" }]);
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.error.field).toBe("email");
  });

  it("omits the envelope field for a multi-field failure (use per-message path)", () => {
    const errors = [
      { field: "email", message_key: "field_required" },
      { field: "name", message_key: "field_required" },
    ];
    const error = new ValidationFailedError("user", errors);
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.error.field).toBeUndefined();
  });
});

// ─── ConcurrentModificationError (optimistic concurrency) ──────────────────

describe("globalErrorHandler – ConcurrentModificationError", () => {
  it("returns 409 with CONCURRENT_MODIFICATION code", () => {
    const error = new ConcurrentModificationError("Invoice", "INV-001", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(409);
    expect(reply.sentData.error.code).toBe("CONCURRENT_MODIFICATION");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts document_modified in messages", () => {
    const error = new ConcurrentModificationError("Invoice", "INV-001", "a", "b");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("document_modified");
  });

  it("passes the trace_id through", () => {
    const error = new ConcurrentModificationError("Invoice", "INV-001", "a", "b");
    const req = mockRequest({ traceId: "trace-conc" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-conc");
  });
});

// ─── PermissionDeniedError ─────────────────────────────────────────────────

describe("globalErrorHandler – PermissionDeniedError", () => {
  it("returns 403 with PERMISSION_DENIED code", () => {
    const error = new PermissionDeniedError("user@test.com", "Invoice", "delete");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.sentData.error.code).toBe("PERMISSION_DENIED");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts the error message in messages[]", () => {
    const error = new PermissionDeniedError("user@test.com", "Invoice", "delete");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages).toHaveLength(1);
    expect(reply.sentData.messages[0].text).toBe(error.message);
  });

  it("passes the trace_id through", () => {
    const error = new PermissionDeniedError("user@test.com", "Invoice", "delete");
    const req = mockRequest({ traceId: "trace-perm" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-perm");
  });
});

// ─── DeleteBlockedError ────────────────────────────────────────────────────

describe("globalErrorHandler – DeleteBlockedError", () => {
  it("returns 409 with DELETE_BLOCKED code", () => {
    const error = new DeleteBlockedError("Customer", "CUST-1", [{ entity: "Invoice", count: 3 }]);
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(409);
    expect(reply.sentData.error.code).toBe("DELETE_BLOCKED");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts the error message in messages[]", () => {
    const error = new DeleteBlockedError("Customer", "CUST-1", [{ entity: "Invoice", count: 3 }]);
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages).toHaveLength(1);
    expect(reply.sentData.messages[0].text).toBe(error.message);
  });

  it("passes the trace_id through", () => {
    const error = new DeleteBlockedError("Customer", "CUST-1", [{ entity: "Invoice", count: 1 }]);
    const req = mockRequest({ traceId: "trace-del" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-del");
  });
});

// ─── DocStatusError ────────────────────────────────────────────────────────

describe("globalErrorHandler – DocStatusError", () => {
  it("returns 400 with DOCSTATUS_ERROR code", () => {
    const error = new DocStatusError("already_submitted", { doctype: "Invoice" });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.sentData.error.code).toBe("DOCSTATUS_ERROR");
    expect(reply.sentData.success).toBe(false);
  });

  it("uses error.messageKey for messages text and detail", () => {
    const error = new DocStatusError("cannot_submit_cancelled", { doctype: "Invoice", name: "INV-001" });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("cannot_submit_cancelled");
    expect(reply.sentData.error.detail).toBe("cannot_submit_cancelled");
  });

  it("passes the trace_id through", () => {
    const error = new DocStatusError("not_submittable", { doctype: "Order" });
    const req = mockRequest({ traceId: "trace-docstatus" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-docstatus");
  });
});

// ─── Login failed ──────────────────────────────────────────────────────────

describe("globalErrorHandler – login_failed", () => {
  it("returns 401 with LOGIN_FAILED code", () => {
    const error = new Error("login_failed");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(401);
    expect(reply.sentData.error.code).toBe("LOGIN_FAILED");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts login_failed in messages", () => {
    const error = new Error("login_failed");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("login_failed");
  });

  it("passes the trace_id through", () => {
    const error = new Error("login_failed");
    const req = mockRequest({ traceId: "trace-login" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-login");
  });
});

// ─── Rate limit ────────────────────────────────────────────────────────────

describe("globalErrorHandler – rate limit (statusCode 429)", () => {
  it("returns 429 with RATE_LIMITED code", () => {
    const error: any = new Error("Too many requests");
    error.statusCode = 429;
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(429);
    expect(reply.sentData.error.code).toBe("RATE_LIMITED");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts rate_limited in messages", () => {
    const error: any = new Error("Too many requests");
    error.statusCode = 429;
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("rate_limited");
  });

  it("passes the trace_id through", () => {
    const error: any = new Error("Too many requests");
    error.statusCode = 429;
    const req = mockRequest({ traceId: "trace-rate" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-rate");
  });
});

// ─── Declared client error (business-rule hook 4xx) ────────────────────────
//
// A hook / service opts a thrown Error into a typed 4xx by attaching an integer
// `statusCode` in [400,499] (the shared `DeclaredClientError` convention). The
// handler surfaces the reason instead of swallowing it into the generic 500.

describe("globalErrorHandler – declared client error (statusCode 4xx)", () => {
  it("honors a declared 422 → status 422 with the reason in messages[0].text + detail", () => {
    const error: any = Object.assign(new Error("over_delivery_not_allowed"), { statusCode: 422 });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(422);
    expect(reply.sentData.status_code).toBe(422);
    expect(reply.sentData.success).toBe(false);
    expect(reply.sentData.data).toBeNull();
    expect(reply.sentData.error.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(reply.sentData.messages).toHaveLength(1);
    expect(reply.sentData.messages[0].text).toBe("over_delivery_not_allowed");
    expect(reply.sentData.messages[0].type).toBe("error");
    expect(reply.sentData.messages[0].show).toBe(true);
    expect(reply.sentData.error.detail).toBe("over_delivery_not_allowed");
  });

  it("honors a declared 409 (lifecycle / state conflict)", () => {
    const error: any = Object.assign(new Error("already_credited"), { statusCode: 409 });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(409);
    expect(reply.sentData.status_code).toBe(409);
    expect(reply.sentData.error.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(reply.sentData.messages[0].text).toBe("already_credited");
  });

  it("surfaces a custom code + field on the envelope and the message path", () => {
    const error: any = Object.assign(new Error("credit limit exceeded"), {
      statusCode: 422,
      code: "CREDIT_LIMIT_EXCEEDED",
      field: "customer",
    });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(422);
    expect(reply.sentData.error.code).toBe("CREDIT_LIMIT_EXCEEDED");
    expect(reply.sentData.error.field).toBe("customer");
    expect(reply.sentData.messages[0].path).toBe("customer");
    expect(reply.sentData.messages[0].text).toBe("credit limit exceeded");
  });

  it("uses messageKey for the shown text (raw message stays in detail) + forwards params", () => {
    const error: any = Object.assign(new Error("raw internal reason"), {
      statusCode: 422,
      messageKey: "over_invoicing_blocked",
      params: { max: "100" },
    });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("over_invoicing_blocked");
    expect(reply.sentData.messages[0].params).toEqual({ max: "100" });
    // The raw Error.message is preserved for diagnostics on the envelope.
    expect(reply.sentData.error.detail).toBe("raw internal reason");
  });

  it("does NOT forward params without a messageKey", () => {
    const error: any = Object.assign(new Error("reason"), { statusCode: 422, params: { max: "100" } });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages[0].params).toBeUndefined();
  });

  it("passes the trace_id through", () => {
    const error: any = Object.assign(new Error("reason"), { statusCode: 422 });
    const req = mockRequest({ traceId: "trace-brv" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-brv");
  });

  it("a declared 500 is NOT surfaced — stays generic INTERNAL_ERROR with NO reason leaked", () => {
    const error: any = Object.assign(new Error("wiring failure detail"), { statusCode: 500 });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.sentData.error.code).toBe("INTERNAL_ERROR");
    expect(reply.sentData.error.detail).toBe("An unexpected error occurred");
    expect(reply.sentData.messages[0].text).toBe("internal_error");
    // The raw reason must NOT leak on a server fault.
    expect(reply.sentData.messages[0].text).not.toBe("wiring failure detail");
    expect(reply.sentData.error.detail).not.toBe("wiring failure detail");
  });

  it("an out-of-range statusCode (399) falls through to the generic 500", () => {
    const error: any = Object.assign(new Error("reason"), { statusCode: 399 });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.sentData.error.code).toBe("INTERNAL_ERROR");
  });

  it("a non-integer / string statusCode ('422') falls through to the generic 500", () => {
    const error: any = Object.assign(new Error("reason"), { statusCode: "422" });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.sentData.error.code).toBe("INTERNAL_ERROR");
  });

  it("statusCode 429 is still RATE_LIMITED, not BUSINESS_RULE_VIOLATION (branch order preserved)", () => {
    const error: any = Object.assign(new Error("Too many requests"), { statusCode: 429 });
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(429);
    expect(reply.sentData.error.code).toBe("RATE_LIMITED");
  });
});

// ─── MongoServerError – duplicate key (E11000) ─────────────────────────────

describe("globalErrorHandler – MongoServerError duplicate key", () => {
  it("returns 409 with DUPLICATE_KEY code", () => {
    const dupKeyError = new MongoServerError({ message: "E11000 duplicate key" });
    (dupKeyError as any).code = 11000;
    (dupKeyError as any).keyPattern = { email: 1 };
    const reply = mockReply();

    globalErrorHandler(dupKeyError, mockRequest(), reply);

    expect(reply.statusCode).toBe(409);
    expect(reply.sentData.error.code).toBe("DUPLICATE_KEY");
    expect(reply.sentData.success).toBe(false);
  });

  it("includes the duplicate field name in detail", () => {
    const dupKeyError = new MongoServerError({ message: "E11000 duplicate key" });
    (dupKeyError as any).code = 11000;
    (dupKeyError as any).keyPattern = { email: 1 };
    const reply = mockReply();

    globalErrorHandler(dupKeyError, mockRequest(), reply);

    expect(reply.sentData.error.detail).toContain("email");
  });

  it("falls back to 'unknown' field when keyPattern is absent", () => {
    const dupKeyError = new MongoServerError({ message: "E11000 duplicate key" });
    (dupKeyError as any).code = 11000;
    const reply = mockReply();

    globalErrorHandler(dupKeyError, mockRequest(), reply);

    expect(reply.sentData.error.detail).toContain("unknown");
  });

  it("binds the duplicate field via error.field + message path", () => {
    const dupKeyError = new MongoServerError({ message: "E11000 duplicate key" });
    (dupKeyError as any).code = 11000;
    (dupKeyError as any).keyPattern = { email: 1 };
    const reply = mockReply();

    globalErrorHandler(dupKeyError, mockRequest(), reply);

    expect(reply.sentData.error.field).toBe("email");
    expect(reply.sentData.messages[0].path).toBe("email");
    expect(reply.sentData.messages[0].params).toEqual({ field: "email" });
  });

  it("omits error.field + message path when the field is unknown", () => {
    const dupKeyError = new MongoServerError({ message: "E11000 duplicate key" });
    (dupKeyError as any).code = 11000;
    const reply = mockReply();

    globalErrorHandler(dupKeyError, mockRequest(), reply);

    expect(reply.sentData.error.field).toBeUndefined();
    expect(reply.sentData.messages[0].path).toBeUndefined();
  });

  it("passes the trace_id through", () => {
    const dupKeyError = new MongoServerError({ message: "E11000 duplicate key" });
    (dupKeyError as any).code = 11000;
    (dupKeyError as any).keyPattern = { email: 1 };
    const req = mockRequest({ traceId: "trace-dup" });
    const reply = mockReply();

    globalErrorHandler(dupKeyError, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-dup");
  });
});

// ─── MongoServerError – other server errors ────────────────────────────────

describe("globalErrorHandler – MongoServerError (non-duplicate)", () => {
  it("returns 500 with DATABASE_ERROR code", () => {
    const serverError = new MongoServerError({ message: "Query failed", code: 50 });
    const reply = mockReply();

    globalErrorHandler(serverError, mockRequest(), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.sentData.error.code).toBe("DATABASE_ERROR");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts database_error in messages", () => {
    const serverError = new MongoServerError({ message: "Query failed", code: 50 });
    const reply = mockReply();

    globalErrorHandler(serverError, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("database_error");
  });

  it("passes the trace_id through", () => {
    const serverError = new MongoServerError({ message: "Query failed", code: 50 });
    const req = mockRequest({ traceId: "trace-db" });
    const reply = mockReply();

    globalErrorHandler(serverError, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-db");
  });
});

// ─── MongoNetworkTimeoutError ──────────────────────────────────────────────

describe("globalErrorHandler – MongoNetworkTimeoutError", () => {
  it("returns 503 with DATABASE_UNAVAILABLE code", () => {
    const error = makeMongoError(MongoNetworkTimeoutError, { message: "connection timed out" });
    const reply = mockReply();

    globalErrorHandler(error as any, mockRequest(), reply);

    expect(reply.statusCode).toBe(503);
    expect(reply.sentData.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts database_unavailable in messages", () => {
    const error = makeMongoError(MongoNetworkTimeoutError, { message: "connection timed out" });
    const reply = mockReply();

    globalErrorHandler(error as any, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("database_unavailable");
  });

  it("passes the trace_id through", () => {
    const error = makeMongoError(MongoNetworkTimeoutError, { message: "timeout" });
    const req = mockRequest({ traceId: "trace-timeout" });
    const reply = mockReply();

    globalErrorHandler(error as any, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-timeout");
  });
});

// ─── MongoServerSelectionError ─────────────────────────────────────────────

describe("globalErrorHandler – MongoServerSelectionError", () => {
  it("returns 503 with DATABASE_UNAVAILABLE code", () => {
    const error = makeMongoError(MongoServerSelectionError, { message: "No primary found" });
    const reply = mockReply();

    globalErrorHandler(error as any, mockRequest(), reply);

    expect(reply.statusCode).toBe(503);
    expect(reply.sentData.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts database_unavailable in messages", () => {
    const error = makeMongoError(MongoServerSelectionError, { message: "No primary found" });
    const reply = mockReply();

    globalErrorHandler(error as any, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("database_unavailable");
  });

  it("passes the trace_id through", () => {
    const error = makeMongoError(MongoServerSelectionError, { message: "No primary found" });
    const req = mockRequest({ traceId: "trace-sse" });
    const reply = mockReply();

    globalErrorHandler(error as any, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-sse");
  });
});

// ─── MongoNetworkError ─────────────────────────────────────────────────────

describe("globalErrorHandler – MongoNetworkError", () => {
  it("returns 503 with DATABASE_UNAVAILABLE code", () => {
    const error = makeMongoError(MongoNetworkError, { message: "Connection refused" });
    const reply = mockReply();

    globalErrorHandler(error as any, mockRequest(), reply);

    expect(reply.statusCode).toBe(503);
    expect(reply.sentData.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts database_unavailable in messages", () => {
    const error = makeMongoError(MongoNetworkError, { message: "Connection refused" });
    const reply = mockReply();

    globalErrorHandler(error as any, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("database_unavailable");
  });

  it("passes the trace_id through", () => {
    const error = makeMongoError(MongoNetworkError, { message: "Connection refused" });
    const req = mockRequest({ traceId: "trace-net" });
    const reply = mockReply();

    globalErrorHandler(error as any, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-net");
  });
});

// ─── MongoWriteConcernError ────────────────────────────────────────────────
//
// MongoWriteConcernError extends MongoServerError. The handler checks
// MongoWriteConcernError before MongoServerError to ensure the more specific
// error type is matched first.

describe("globalErrorHandler – MongoWriteConcernError", () => {
  it("returns 500 with DATABASE_WRITE_ERROR code", () => {
    const error = makeMongoError(MongoWriteConcernError, { message: "Write concern not satisfied" });
    const reply = mockReply();

    globalErrorHandler(error as any, mockRequest(), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.sentData.success).toBe(false);
  });

  it("is caught by the MongoWriteConcernError branch (before MongoServerError)", () => {
    const error = makeMongoError(MongoWriteConcernError, { message: "Write concern not satisfied" });
    const reply = mockReply();

    globalErrorHandler(error as any, mockRequest(), reply);

    expect(reply.sentData.error.code).toBe("DATABASE_WRITE_ERROR");
  });

  it("passes the trace_id through", () => {
    const error = makeMongoError(MongoWriteConcernError, { message: "Write concern not satisfied" });
    const req = mockRequest({ traceId: "trace-wce" });
    const reply = mockReply();

    globalErrorHandler(error as any, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-wce");
  });
});

// ─── Unknown error ─────────────────────────────────────────────────────────

describe("globalErrorHandler – unknown error", () => {
  it("returns 500 with INTERNAL_ERROR code", () => {
    const error = new Error("something unexpected");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.sentData.error.code).toBe("INTERNAL_ERROR");
    expect(reply.sentData.success).toBe(false);
  });

  it("puts internal_error in messages", () => {
    const error = new Error("something unexpected");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    expect(reply.sentData.messages[0].text).toBe("internal_error");
  });

  it("passes the trace_id through", () => {
    const error = new Error("something unexpected");
    const req = mockRequest({ traceId: "trace-unknown" });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("trace-unknown");
  });

  it("uses empty string when traceId is absent from the request", () => {
    const error = new Error("unexpected");
    const req = mockRequest({ traceId: undefined });
    const reply = mockReply();

    globalErrorHandler(error, req, reply);

    expect(reply.sentData.error.trace_id).toBe("");
  });
});

// ─── ApiResponse<null> shape ───────────────────────────────────────────────

describe("globalErrorHandler – response shape", () => {
  it("every error response has the full ApiResponse<null> shape", () => {
    const error = new NotFoundError("Invoice", "INV-001");
    const reply = mockReply();

    globalErrorHandler(error, mockRequest(), reply);

    const data = reply.sentData;
    expect(data).toHaveProperty("success", false);
    expect(data).toHaveProperty("status_code", 404);
    expect(data).toHaveProperty("data", null);
    expect(data).toHaveProperty("messages");
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data).toHaveProperty("error");
    expect(data.error).toHaveProperty("code");
    expect(data.error).toHaveProperty("detail");
    expect(data.error).toHaveProperty("trace_id");
  });
});
