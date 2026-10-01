import { createHmac, timingSafeEqual } from "node:crypto";

/** A record form posted later than this after its page rendered is refused. Pages render on every
 *  request, so only a visitor who kept the page open for a day meets it, and a reload helps them. */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

/** What a record form was rendered for: the app and entity its block names, the names of every
 *  field it draws or sends hidden, and when the server rendered it. */
export interface SignedForm {
  app: string;
  entity: string;
  fields: string[];
  renderedAt: number;
}

const mac = (key: string, payload: string): Buffer => createHmac("sha256", key).update(payload).digest();

/**
 * The signature a record form sends back with its post: the form it was rendered for, and an HMAC of
 * it under a key only the renderer holds. A program can read it from the page but cannot make one for
 * another app, entity, field or render time.
 */
export function signForm(key: string, form: SignedForm): string {
  const payload = Buffer.from(JSON.stringify({ a: form.app, e: form.entity, f: form.fields, t: form.renderedAt })).toString("base64url");
  return `${payload}.${mac(key, payload).toString("base64url")}`;
}

const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every((name) => typeof name === "string");

/** The form a signature was made for, or null when the key did not make it. */
export function readSignedForm(key: string, signature: unknown): SignedForm | null {
  if (typeof signature !== "string") return null;
  const [payload, tag, ...rest] = signature.split(".");
  if (!payload || !tag || rest.length) return null;
  const expected = mac(key, payload);
  const given = Buffer.from(tag, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const form = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  const { a, e, f, t } = form;
  if (typeof a !== "string" || typeof e !== "string" || !isNames(f) || typeof t !== "number") return null;
  return { app: a, entity: e, fields: f, renderedAt: t };
}

/**
 * Whether a post is one the signed form could send: the same app and entity, only keys the form has,
 * the render time it was signed with, and not older than MAX_FORM_AGE_MS. A form leaves an empty
 * value out, so a post may hold fewer keys than the form.
 */
export function postMatchesForm(form: SignedForm, post: { app: string; entity: string; keys: string[]; renderedAt: unknown }, now: number): boolean {
  if (form.app !== post.app || form.entity !== post.entity || form.renderedAt !== post.renderedAt) return false;
  if (now - form.renderedAt > MAX_FORM_AGE_MS) return false;
  const names = new Set(form.fields);
  return post.keys.every((key) => names.has(key));
}
