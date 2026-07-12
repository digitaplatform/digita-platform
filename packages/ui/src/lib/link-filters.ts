/**
 * Resolve dynamic tokens in a Link field's `target_filters` against the current
 * document, so a link picker can be narrowed by the document's own context.
 *
 * A filter value of the form `"$doc.<field>"` is replaced by the document's
 * `<field>` value; static values pass through unchanged. A `$doc.*` token that
 * resolves to null/empty DROPS that filter entry — an unfilled sibling field must
 * not narrow the picker to nothing.
 *
 * Generic and app-agnostic by design: the engine knows nothing about "company" or
 * any domain concept. An app that wants e.g. tax-rate-by-company-country simply
 * fetches the company's country into a document field (fetch_from company.country)
 * and sets `target_filters: { country: "$doc.<that field>" }`.
 */
export function resolveLinkFilters(
  filters: Record<string, unknown> | undefined,
  doc: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!filters) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (typeof val === "string" && val.startsWith("$doc.")) {
      const resolved = doc?.[val.slice(5)];
      if (resolved == null || resolved === "") continue; // unresolved → drop, don't over-filter
      out[key] = resolved;
    } else {
      out[key] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
