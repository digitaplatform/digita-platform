import type { DeclaredClientError } from "@digitaplatform/shared";

/**
 * The thrown value when it declares a client error by the shared `DeclaredClientError` convention,
 * an integer `statusCode` in 400-499; nothing otherwise. An app's business-rule hook throws one and
 * expects its reason to reach the person, so it is a refusal, never a server fault.
 */
export function findDeclaredClientError(err: unknown): (Error & DeclaredClientError) | undefined {
  const statusCode = (err as { statusCode?: unknown } | null | undefined)?.statusCode;
  const isDeclared = typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 499;
  return isDeclared ? (err as Error & DeclaredClientError) : undefined;
}

/**
 * What a person reads of a declared client error: its message key with the key's params, else the
 * hook's own sentence, which the translation passes through unchanged as a key it does not hold.
 */
export function declaredClientMessage(error: Error & DeclaredClientError): {
  text: string;
  params?: Record<string, string>;
  field?: string;
} {
  return {
    text: error.messageKey ?? error.message,
    ...(error.messageKey && error.params ? { params: error.params } : {}),
    ...(error.field ? { field: error.field } : {}),
  };
}
