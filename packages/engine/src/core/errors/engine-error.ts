/**
 * An error the engine raises: a `code` of translations/digita-engine/ with its `params`, never a
 * finished sentence. The error handler sends the code with its params as the response message,
 * which the response hook translates into the requester's language, and answers with `status`.
 * `responseCode` is the response's `error.code`, the machine code an API client branches on.
 * The message is the code too, so a log or a stack trace shows what to search for. `field` names
 * the field the error is about, which the app binds the message to.
 */
export class EngineError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string>,
    readonly status: number,
    readonly responseCode: string,
    readonly field?: string,
  ) {
    super(code);
    this.name = new.target.name;
  }
}

/**
 * A setting, a key or a file the engine needs that is missing or malformed: the operator's fault,
 * so it answers 500. Raised at start-up it may come before the catalog is loaded, and its log entry
 * then carries the code and the params without a text.
 */
export class ConfigurationError extends EngineError {
  constructor(code: string, params: Record<string, string> = {}) {
    super(code, params, 500, "CONFIGURATION_INVALID");
  }
}
