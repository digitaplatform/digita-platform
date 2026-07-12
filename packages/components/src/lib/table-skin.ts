/**
 * THE table skin — the one visual vocabulary every tabular surface shares:
 * the kit DataGrid, the app list table, mini tables in context panels.
 * Import these class strings instead of copying them; drift is then an
 * import-site diff, not a design-review finding.
 *
 * Language: soft card frame, calm subtle header with uppercase micro labels,
 * hairline row separation, the canonical bgHover row hover, subtle footer.
 * Density-aware paddings stay with the CONSUMER (list cells read the
 * --density-* vars; the grid derives its row height from them).
 */
export const tableSkin = {
  /** Outer frame around any table surface. */
  frame: 'rounded-card border border-border bg-surface shadow-xs',
  /** Header band (thead / grid header row). */
  header: 'border-b border-border bg-subtle text-textMuted',
  /** A header cell's type treatment. */
  headerCell: 'text-micro font-medium uppercase tracking-wide',
  /** A body row: hairline separation + the canonical hover fill. */
  row: 'border-b border-border transition-colors duration-base ease-smooth hover:bg-bgHover',
  /** Footer band (totals). */
  footer: 'border-t border-border bg-subtle text-sm font-medium',
} as const;
