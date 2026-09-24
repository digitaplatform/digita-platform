/** JSON for the body of a `<script>` data block. `<`, `>` and `&` are written as unicode escapes,
 *  so no string in the value can end the element or open markup inside it; the parsed value is
 *  unchanged. */
export function jsonForScript(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
