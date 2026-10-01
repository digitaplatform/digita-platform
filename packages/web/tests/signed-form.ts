import { signForm } from "../src/lib/form-signature";

/** The signing key of the tests' renderer (FORM_SIGNING_KEY). */
export const TEST_FORM_KEY = "test-form-signing-key-0123456789abcdef";

/** A record post with the signature a form of its app, entity and keys was rendered with. */
export function signed<T extends { app?: string; entity: string; values: object; rendered_at: number }>(post: T, fields = Object.keys(post.values)): T & { form: string } {
  return { ...post, form: signForm(TEST_FORM_KEY, { app: post.app ?? "", entity: post.entity, fields, renderedAt: post.rendered_at }) };
}
