import type { ResponseMessage } from "@digitaplatform/shared";

export interface MessageOptions {
  /** JSON pointer into the response body (e.g. "/sections/<sectionKey>"). */
  path?: string;
  /** Machine-readable code so callers can branch without parsing text. */
  code?: string;
}

/**
 * Collects response messages during a request lifecycle.
 * Messages are translated before being added (translation integration is in the middleware layer).
 */
export class ResponseContext {
  private messages: ResponseMessage[] = [];
  // Messages store the message KEY + interpolation params. The engine's
  // preSerialization i18n hook translates them with the request locale
  // (server-side i18n via the shared translator). addRaw() bypasses this for
  // already-final text.

  private push(
    text: string,
    type: ResponseMessage["type"],
    show: boolean,
    opts?: MessageOptions,
    params?: Record<string, string>,
  ): void {
    const msg: ResponseMessage = { text, type, show };
    if (opts?.path) msg.path = opts.path;
    if (opts?.code) msg.code = opts.code;
    if (params) msg.params = params;
    this.messages.push(msg);
  }

  // ─── Show to user ──────────────────────────────────────

  success(messageKey: string, params?: Record<string, string>, opts?: MessageOptions): void {
    this.push(messageKey, "success", true, opts, params);
  }

  warning(messageKey: string, params?: Record<string, string>, opts?: MessageOptions): void {
    this.push(messageKey, "warning", true, opts, params);
  }

  error(messageKey: string, params?: Record<string, string>, opts?: MessageOptions): void {
    this.push(messageKey, "error", true, opts, params);
  }

  // ─── Silent (only in response body) ────────────────────

  info(messageKey: string, params?: Record<string, string>, opts?: MessageOptions): void {
    this.push(messageKey, "info", false, opts, params);
  }

  // ─── Explicit control ─────────────────────────────────

  message(
    messageKey: string,
    type: ResponseMessage["type"],
    show: boolean,
    params?: Record<string, string>,
    opts?: MessageOptions,
  ): void {
    this.push(messageKey, type, show, opts, params);
  }

  /**
   * Add a pre-translated message directly.
   */
  addRaw(text: string, type: ResponseMessage["type"], show: boolean, opts?: MessageOptions): void {
    this.push(text, type, show, opts);
  }

  // ─── Access ────────────────────────────────────────────

  getMessages(): ResponseMessage[] {
    return this.messages;
  }

  hasErrors(): boolean {
    return this.messages.some((m) => m.type === "error");
  }

  clear(): void {
    this.messages = [];
  }
}
