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

  constructor(message: string, status: number, response?: ApiResponse) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.response = response;
    this.field = response?.error?.field;
    this.code = response?.error?.code;
  }
}

function isApiResponse(body: unknown): body is ApiResponse {
  return typeof body === 'object' && body !== null && 'success' in body && 'messages' in body;
}

/** Build an ApiClientError from a non-OK response body (ApiResponse or plain). */
export function toApiError(status: number, body: unknown): ApiClientError {
  if (isApiResponse(body)) {
    const detail =
      body.error?.detail ??
      body.messages.find((m) => m.type === 'error')?.text ??
      `Request failed with status ${status}`;
    return new ApiClientError(detail, status, body);
  }
  const generic =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as Record<string, unknown>)['message'])
      : `Request failed with status ${status}`;
  return new ApiClientError(generic, status);
}
