export interface ResponseMessage {
  /** After server-side i18n: the localized text. Before the hook: the message key. */
  text: string;
  type: "success" | "info" | "warning" | "error";
  show: boolean;
  /** JSON pointer into the response body (e.g. "/sections/recent_items"). */
  path?: string;
  /** Machine-readable code so callers can branch without parsing text. */
  code?: string;
  /** Transient: interpolation params for server-side translation. Consumed +
   *  removed by the engine's preSerialization i18n hook — never sent to clients. */
  params?: Record<string, string>;
}

export interface ApiError {
  code: string;
  detail: string;
  field?: string;
  trace_id: string;
}

/**
 * Convention for a hook / service to DECLARE that a thrown error is a CLIENT
 * error (a 4xx business-rule / lifecycle rejection), not an internal server
 * fault. The engine's global error handler DUCK-TYPES any thrown `Error`
 * carrying an integer `statusCode` in the range [400, 499] and surfaces it as a
 * typed 4xx `ApiResponse` (with the message reaching the client) instead of
 * swallowing it into the generic 500 fallthrough.
 *
 * This is a DOCUMENTATION type only — throwers do NOT import a class and do
 * `instanceof`. App hooks load in a SEPARATE package tree at runtime (prod
 * loads apps independently of the engine), so a shared error class would be a
 * dual-package `instanceof` hazard. Instead a thrower attaches these props to a
 * plain Error:
 *
 * ```ts
 * throw Object.assign(new Error("over_delivery_not_allowed"), { statusCode: 422 });
 * ```
 *
 * Convention: default **422** (business rule violated); use **409** for
 * lifecycle / state conflicts. Any declared status outside [400, 499] (e.g. a
 * bare `500`, or a non-integer / string value) is IGNORED and still yields the
 * generic 500 — no silent fallback, so genuine server faults stay loud.
 */
export interface DeclaredClientError {
  /** Integer HTTP status in [400, 499]. REQUIRED to opt into 4xx surfacing. */
  statusCode: number;
  /** Machine-readable error code → `error.code`. Defaults to
   *  `"BUSINESS_RULE_VIOLATION"` when absent. */
  code?: string;
  /** Offending field name → bound to `error.field` and the message `path` so
   *  the frontend can attach the error to the exact control. */
  field?: string;
  /** i18n message key to show INSTEAD of the raw `Error.message`. When present,
   *  the raw message is preserved in `error.detail` for diagnostics. */
  messageKey?: string;
  /** Interpolation params for `messageKey`'s server-side translation. Only
   *  forwarded when `messageKey` is also set. */
  params?: Record<string, string>;
}

export interface PaginationMeta {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  status_code: number;
  data: T | null;
  meta?: PaginationMeta;
  messages: ResponseMessage[];
  error?: ApiError;
}
