import type { ApiResponse } from '@digitaplatform/shared';
import { ApiClientError } from '@/lib/errors';

/**
 * One shared mapping from the `ApiResponse` envelope to UI-ready messages.
 * `unwrap` fails loud on a null/undefined payload (a contract bug, never coerced
 * to {}/[]). Error CLASSIFICATION is by HTTP status (the thrown ApiClientError),
 * never by `body.success` — the action-not-found path returns 404 with
 * success:true. Every message text runs through `t()` defensively (error-path
 * text is frequently a raw i18n key like `period_closed` / `duplicate_key`).
 */

export interface UiMessage {
  type: 'success' | 'info' | 'warning' | 'error';
  text: string;
  /** Fieldname for form-field binding (from messages[].path), when present. */
  path?: string;
}

type TFn = (key: string, params?: Record<string, string | number>) => string;

/** Return the payload or throw — an empty list `[]` is valid, only null/undefined is a bug. */
export function unwrap<T>(res: ApiResponse<T>): T {
  if (!res.success || res.data === null || res.data === undefined) {
    throw new ApiClientError(
      res.error?.detail ?? 'Empty response payload',
      res.status_code ?? 500,
      res as ApiResponse,
    );
  }
  return res.data;
}

export function toUiMessages(err: unknown, t: TFn): UiMessage[] {
  if (err instanceof ApiClientError && err.response) {
    const msgs = err.response.messages ?? [];
    if (msgs.length > 0) {
      return msgs.map((m) => ({ type: m.type, text: t(m.text), path: m.path }));
    }
    return [{ type: 'error', text: t(err.message) }];
  }
  if (err instanceof Error) return [{ type: 'error', text: err.message }];
  return [{ type: 'error', text: String(err) }];
}

export function successMessages(res: ApiResponse, t: TFn): UiMessage[] {
  return (res.messages ?? []).map((m) => ({ type: m.type, text: t(m.text), path: m.path }));
}
