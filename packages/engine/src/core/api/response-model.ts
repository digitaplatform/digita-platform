import type { ApiResponse, ResponseMessage, PaginationMeta } from "@digitaplatform/shared";

/**
 * Build a successful API response.
 */
export function successResponse<T>(
  data: T,
  messages: ResponseMessage[] = [],
  meta?: PaginationMeta,
): ApiResponse<T> {
  return {
    success: true,
    status_code: 200,
    data,
    messages,
    ...(meta ? { meta } : {}),
  };
}

/**
 * Build an error API response.
 */
export function errorResponse(
  statusCode: number,
  code: string,
  detail: string,
  messages: ResponseMessage[],
  traceId: string,
  field?: string,
): ApiResponse<null> {
  return {
    success: false,
    status_code: statusCode,
    data: null,
    messages,
    error: {
      code,
      detail,
      trace_id: traceId,
      ...(field ? { field } : {}),
    },
  };
}
