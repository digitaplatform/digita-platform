/** How a form's post failed, sorted by what the visitor can do about it. */
export type FormFailure =
  | { kind: "invalid"; field?: string }
  | { kind: "unavailable" }
  | { kind: "tooMany"; waitSeconds?: number };

/** The texts a form tells a failure with. Only `failed` is required: a form that carries no text for
 *  a class tells it with `failed`, as every failure was told before there were classes. */
export interface FormFailureTexts {
  /** The post was wrong and no field the visitor sees is named: check the details. */
  failed: string;
  /** The post was wrong in one field; `{field}` is the label the visitor sees on it. */
  invalidField?: string;
  /** The form cannot be sent right now: the route refused it or no engine could take it. */
  unavailable?: string;
  /** The visitor sent too many forms; `{time}` is when they can try again, as "in 5 minutes". */
  tooMany?: string;
}

/**
 * The failure a route's answer stands for, from its status. A 400 is the visitor's to correct, and
 * its body may name the field. A 403 or a server error is not: nothing they typed is wrong. A 429
 * names its wait in the standard header. Any other status keeps the telling every failure had:
 * check the details.
 */
export async function readFormFailure(res: Response): Promise<FormFailure> {
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After"));
    return { kind: "tooMany", waitSeconds: Number.isInteger(wait) && wait > 0 ? wait : undefined };
  }
  if (res.status === 403 || res.status >= 500) return { kind: "unavailable" };
  if (res.status !== 400) return { kind: "invalid" };
  // A 400 is wrong with or without a named field, so a body that is no JSON leaves it without one.
  const body = (await res.json().catch(() => null)) as { field?: unknown } | null;
  return typeof body?.field === "string" ? { kind: "invalid", field: body.field } : { kind: "invalid" };
}

/** When a wait of `seconds` is over, worded for `locale` as "in 5 minutes". It rounds up, so a
 *  visitor who waits that long is never early, and it names whole hours as hours. */
export function waitPhrase(seconds: number, locale?: string): string {
  const words = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes % 60 === 0 ? words.format(minutes / 60, "hour") : words.format(minutes, "minute");
}

/** What a failed post tells the visitor. `labelOf` gives the label the visitor sees on a field, and
 *  nothing for a field they do not see, which no text can name to them. */
export function failureText(
  failure: FormFailure,
  texts: FormFailureTexts,
  labelOf: (field: string) => string | undefined,
  locale?: string,
): string {
  switch (failure.kind) {
    case "invalid": {
      const label = failure.field === undefined ? undefined : labelOf(failure.field);
      // A function as the replacement, so a `$` in an authored label is text, not a pattern.
      return texts.invalidField && label ? texts.invalidField.replace("{field}", () => label) : texts.failed;
    }
    case "unavailable":
      return texts.unavailable ?? texts.failed;
    case "tooMany": {
      // A wait the answer does not name is not guessed: the visitor is told only that the form is closed to them for now.
      const { waitSeconds } = failure;
      if (texts.tooMany && waitSeconds !== undefined) return texts.tooMany.replace("{time}", () => waitPhrase(waitSeconds, locale));
      return texts.unavailable ?? texts.failed;
    }
  }
}
