import { describe, it, expect } from "vitest";
import { successResponse, errorResponse } from "../src/core/api/response-model.js";

// ─── successResponse ───────────────────────────────────────────────────────

describe("successResponse", () => {
  it("returns success=true and status_code=200", () => {
    const result = successResponse({ id: 1 });

    expect(result.success).toBe(true);
    expect(result.status_code).toBe(200);
  });

  it("sets data to the provided value", () => {
    const data = { name: "Alice", age: 30 };
    const result = successResponse(data);

    expect(result.data).toEqual(data);
  });

  it("defaults to an empty messages array when none provided", () => {
    const result = successResponse("hello");

    expect(result.messages).toEqual([]);
  });

  it("includes provided messages in the response", () => {
    const messages = [{ text: "saved", type: "success" as const, show: true }];
    const result = successResponse({ id: 1 }, messages);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.text).toBe("saved");
    expect(result.messages[0]!.type).toBe("success");
    expect(result.messages[0]!.show).toBe(true);
  });

  it("does not include a meta property when meta is not provided", () => {
    const result = successResponse({ id: 1 });

    expect(result).not.toHaveProperty("meta");
  });

  it("includes the meta property when provided", () => {
    const meta = { page: 1, page_size: 20, total: 100, total_pages: 5 };
    const result = successResponse([{ id: 1 }], [], meta);

    expect(result.meta).toEqual(meta);
  });

  it("accepts null as data", () => {
    const result = successResponse(null);

    expect(result.data).toBeNull();
    expect(result.success).toBe(true);
  });

  it("accepts an array as data", () => {
    const data = [{ id: 1 }, { id: 2 }];
    const result = successResponse(data);

    expect(result.data).toHaveLength(2);
  });

  it("does not add an error property", () => {
    const result = successResponse({ id: 1 });

    expect(result).not.toHaveProperty("error");
  });

  it("multiple messages are all preserved", () => {
    const messages = [
      { text: "row 1 saved", type: "info" as const, show: true },
      { text: "row 2 saved", type: "info" as const, show: false },
    ];
    const result = successResponse({}, messages);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]!.show).toBe(false);
  });
});

// ─── errorResponse ─────────────────────────────────────────────────────────

describe("errorResponse", () => {
  it("returns success=false", () => {
    const result = errorResponse(400, "BAD_REQUEST", "Bad input", [], "trace-1");

    expect(result.success).toBe(false);
  });

  it("sets status_code to the provided value", () => {
    const result = errorResponse(422, "UNPROCESSABLE", "Invalid data", [], "trace-1");

    expect(result.status_code).toBe(422);
  });

  it("sets data to null", () => {
    const result = errorResponse(500, "INTERNAL_ERROR", "Oops", [], "trace-1");

    expect(result.data).toBeNull();
  });

  it("sets error.code to the provided code", () => {
    const result = errorResponse(404, "NOT_FOUND", "Resource missing", [], "trace-1");

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("sets error.detail to the provided detail string", () => {
    const result = errorResponse(404, "NOT_FOUND", "Invoice INV-001 not found", [], "trace-1");

    expect(result.error?.detail).toBe("Invoice INV-001 not found");
  });

  it("sets error.trace_id to the provided traceId", () => {
    const result = errorResponse(500, "INTERNAL_ERROR", "Unexpected", [], "my-trace-id");

    expect(result.error?.trace_id).toBe("my-trace-id");
  });

  it("includes provided messages in the response", () => {
    const messages = [{ text: "not_found", type: "error" as const, show: true }];
    const result = errorResponse(404, "NOT_FOUND", "Missing", messages, "trace-1");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.text).toBe("not_found");
  });

  it("does not include a field property when field is not provided", () => {
    const result = errorResponse(400, "BAD_REQUEST", "Bad input", [], "trace-1");

    expect(result.error).not.toHaveProperty("field");
  });

  it("includes the field property when provided", () => {
    const result = errorResponse(400, "VALIDATION_ERROR", "Email invalid", [], "trace-1", "email");

    expect(result.error?.field).toBe("email");
  });

  it("accepts an empty messages array", () => {
    const result = errorResponse(500, "INTERNAL_ERROR", "Oops", [], "trace-1");

    expect(result.messages).toEqual([]);
  });

  it("accepts multiple messages", () => {
    const messages = [
      { text: "error_a", type: "error" as const, show: true },
      { text: "error_b", type: "error" as const, show: true },
    ];
    const result = errorResponse(400, "VALIDATION_ERROR", "Two errors", messages, "trace-1");

    expect(result.messages).toHaveLength(2);
  });

  it("does not add a meta property", () => {
    const result = errorResponse(500, "INTERNAL_ERROR", "Oops", [], "trace-1");

    expect(result).not.toHaveProperty("meta");
  });

  it("full ApiResponse<null> shape is correct for a 403 error", () => {
    const messages = [{ text: "permission_denied", type: "error" as const, show: true }];
    const result = errorResponse(403, "PERMISSION_DENIED", "Access denied", messages, "t-403", "role");

    expect(result).toMatchObject({
      success: false,
      status_code: 403,
      data: null,
      messages: [{ text: "permission_denied", type: "error", show: true }],
      error: {
        code: "PERMISSION_DENIED",
        detail: "Access denied",
        trace_id: "t-403",
        field: "role",
      },
    });
  });
});
