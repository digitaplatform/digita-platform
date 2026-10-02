import type { ApiResponse } from '@digitaplatform/shared';

/**
 * Error thrown by the API client. Carries the HTTP status and, when the engine
 * answered with its `ApiResponse` envelope, the structured error + the first
 * error message so callers can surface field-level problems. No silent
 * swallowing — every non-OK response becomes one of these (the no-silent-
 * fallback rule).
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly response?: ApiResponse;
  readonly field?: string;
  readonly code?: string;
  /** The text the server sent for the person, in their language. Undefined when it sent none, and
   *  `message` is then the client's own English fallback or a bare code. */
  readonly reason?: string;

  constructor(message: string, status: number, response?: ApiResponse, reason?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.response = response;
    this.field = response?.error?.field;
    this.code = response?.error?.code;
    this.reason = reason;
  }
}

function isApiResponse(body: unknown): body is ApiResponse {
  return typeof body === 'object' && body !== null && 'success' in body && 'messages' in body;
}

/** Build an ApiClientError from a non-OK response body (ApiResponse or plain). */
export function toApiError(status: number, body: unknown): ApiClientError {
  if (isApiResponse(body)) {
    // The first error message is the person's text, which the engine translated; the detail of an
    // engine error is its code.
    const reason = body.messages.find((m) => m.type === 'error')?.text || undefined;
    return new ApiClientError(reason || body.error?.detail || `Request failed with status ${status}`, status, body, reason);
  }
  const plain = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const message = typeof plain['message'] === 'string' ? plain['message'] : undefined;
  // A service's translator answers a code it has no text for with the code itself, so a `message`
  // equal to its `error` is no text for a person.
  const reason = message && message !== plain['error'] ? message : undefined;
  return new ApiClientError(message ?? `Request failed with status ${status}`, status, undefined, reason);
}
