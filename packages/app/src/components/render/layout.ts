import type { FieldDefinition, FormLayoutConfig } from '@digitaplatform/shared';

/**
 * Parse a flat `fields[]` into the Tabs → Sections → Columns tree the FormRenderer
 * walks. Layout-break fields
 * (Tab/Section/Column) structure the tree; everything else (real fields +
 * Heading/HTML/Button) lands in the current column. Pure + locale-free —
 * localization happens at render. Empty tabs are dropped.
 */

export interface LayoutColumn {
  fields: FieldDefinition[];
}
export interface LayoutSection {
  key: string;
  label: string;
  collapsible: boolean;
  defaultCollapsed: boolean;
  columns: LayoutColumn[];
}
export interface LayoutTab {
  key: string;
  label: string;
  sections: LayoutSection[];
}

export function parseLayout(fields: FieldDefinition[]): LayoutTab[] {
  const tabs: LayoutTab[] = [];
  let tab: LayoutTab | null = null;
  let section: LayoutSection | null = null;
  let column: LayoutColumn | null = null;

  const ensureTab = (): LayoutTab => {
    if (!tab) {
      tab = { key: '_details', label: '', sections: [] };
      tabs.push(tab);
    }
    return tab;
  };
  const ensureSection = (): LayoutSection => {
    if (!section) {
      section = { key: '_main', label: '', collapsible: false, defaultCollapsed: false, columns: [] };
      ensureTab().sections.push(section);
    }
    return section;
  };
  const ensureColumn = (): LayoutColumn => {
    if (!column) {
      column = { fields: [] };
      ensureSection().columns.push(column);
    }
    return column;
  };

  for (const f of fields) {
    if (f.hidden && f.fieldtype !== 'SectionBreak' && f.fieldtype !== 'TabBreak') {
      // depends_on visibility is handled at render; statically-hidden DATA fields
      // are still placed (the sweep may reveal them). Layout breaks are structural.
    }
    switch (f.fieldtype) {
      case 'TabBreak':
        tab = { key: f.fieldname, label: f.label, sections: [] };
        tabs.push(tab);
        section = null;
        column = null;
        break;
      case 'SectionBreak':
        section = {
          key: f.fieldname,
          label: f.label,
          collapsible: !!f.collapsible,
          defaultCollapsed: !!f.collapsed,
          columns: [],
        };
        ensureTab().sections.push(section);
        column = null;
        break;
      case 'ColumnBreak':
        ensureSection();
        column = { fields: [] };
        section!.columns.push(column);
        break;
      default:
        ensureColumn().fields.push(f);
    }
  }

  return tabs.filter((t) => t.sections.some((s) => s.columns.some((c) => c.fields.length > 0)));
}

/** Dev-only: warn once per render-tree on duplicate data fieldnames (they collide
 *  React keys AND a11y ids). Returns the set so the caller can disambiguate. */
export function duplicateFieldnames(fields: FieldDefinition[]): Set<string> {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const f of fields) {
    if (f.fieldtype === 'SectionBreak' || f.fieldtype === 'ColumnBreak' || f.fieldtype === 'TabBreak') continue;
    if (seen.has(f.fieldname)) dups.add(f.fieldname);
    seen.add(f.fieldname);
  }
  if (dups.size > 0 && import.meta.env.DEV) {
    console.warn('[layout] duplicate fieldnames (collide keys + a11y ids):', [...dups]);
  }
  return dups;
}

// ─── Intrinsic field spans (the form-UX "height killer", ADR §3) ───────────────
export type FieldSpan = 4 | 6 | 12;

// Wide types own a full 12-track row; compact scalars go narrow; the workhorse
// text/link half fills 6. Unknown types default to 6 (a safe half-width).
const FULL_WIDTH: ReadonlySet<string> = new Set([
  'Text', 'SmallText', 'TextEditor', 'Code', 'Markdown', 'Table', 'Attach',
  'AttachImage', 'Image', 'JSON', 'Geolocation', 'Signature', 'Heading', 'HTML',
]);
const NARROW: ReadonlySet<string> = new Set([
  'Int', 'Float', 'Currency', 'Percent', 'Check', 'Date', 'Datetime', 'Time',
  'Duration', 'Rating', 'Color', 'Button',
]);

/**
 * Intrinsic grid span (of 12) for a field — the "90% win": a single-column section
 * (no authored ColumnBreak) flows its fields into dense multi-field rows instead of
 * a page-length full-width stack, with zero entity re-authoring. Authored multi-column
 * sections keep their exact layout (the FormRenderer only applies spans when a section
 * has one implicit column).
 */
export function fieldSpan(field: FieldDefinition): FieldSpan {
  // Explicit author override wins over the intrinsic default.
  switch (field.span) {
    case 'xs':
    case 'sm':
      return 4;
    case 'md':
      return 6;
    case 'lg':
    case 'full':
      return 12;
  }
  if (FULL_WIDTH.has(field.fieldtype)) return 12;
  if (NARROW.has(field.fieldtype)) return 4;
  return 6;
}

/** Tailwind col-span classes — mobile stacks every field full-width; tablets get
 *  2-up at `md`; the intrinsic span kicks in at `lg` (responsive-first, ADR-R1).
 *  Static strings so Tailwind emits them. */
export const SPAN_CLASS: Record<FieldSpan, string> = {
  4: 'col-span-12 md:col-span-6 lg:col-span-4',
  6: 'col-span-12 md:col-span-6',
  12: 'col-span-12',
};

// ─── Auto-layout engine (metadata-driven, `entity.form`) ───────────────────────

/** A TabBreak/ColumnBreak makes the form FULLY AUTHORED — the auto engine steps
 *  aside entirely (protects hand-tabbed + column-authored entities). */
const AUTHORING_BREAKS: ReadonlySet<string> = new Set(['TabBreak', 'ColumnBreak']);
/** Non-data decorations — not counted toward the tab/merge thresholds. */
const DECORATION: ReadonlySet<string> = new Set(['Heading', 'HTML', 'Button']);

const DEFAULT_TABIFY = 12;
const DEFAULT_MIN_TAB_FIELDS = 3;

function sectionDataCount(s: LayoutSection): number {
  let n = 0;
  for (const c of s.columns) for (const f of c.fields) if (!DECORATION.has(f.fieldtype)) n++;
  return n;
}

/**
 * Derive the same Tabs → Sections → Columns tree `parseLayout` yields, but
 * organized AUTOMATICALLY for field-dense forms (the owner's "modern responsive,
 * controlled via the entity files"). Contract:
 *
 *  1. Any authored `TabBreak`/`ColumnBreak` in `fields[]` → the layout is fully
 *     authored: return `parseLayout(fields)` UNCHANGED (`entity.form` ignored).
 *  2. Else `entity.form` (or the Layer-1 defaults) steer: when the form is large
 *     enough (`≥ tabify` data fields, default 12) AND has ≥2 SectionBreaks —
 *     or `layout:"tabbed"` — the top-level sections are PROMOTED to tabs (leading
 *     fields → a synthetic `_tab_general`; sections with `< min_tab_fields`
 *     data fields merge into the previous tab, keeping their header). `layout:"flat"`
 *     never tabs. Nothing is reordered, nothing is hidden.
 *  3. Otherwise a single page — the dense intrinsic-span grid, every field shown.
 *
 * Pure + locale-free; tab labels resolve at render (promoted tabs reuse the
 * section i18n key-space; `_tab_general` uses the `ui.form.tabGeneral` chrome key).
 */
export function computeLayout(
  fields: FieldDefinition[],
  form?: FormLayoutConfig,
): LayoutTab[] {
  const tree = parseLayout(fields);

  // Step 0 — authored layout always wins.
  if (fields.some((f) => AUTHORING_BREAKS.has(f.fieldtype))) {
    if (form && import.meta.env.DEV)
      console.warn('[layout] entity.form ignored — fields[] author a TabBreak/ColumnBreak layout');
    return tree;
  }

  const base = tree[0];
  if (!base || tree.length !== 1) return tree; // no fields, or already tabbed elsewhere

  const mode = form?.layout ?? 'auto';
  if (mode === 'flat') return tree;

  const sections = base.sections;
  const authoredSections = sections.filter((s) => s.key !== '_main').length;
  const dataCount = sections.reduce((n, s) => n + sectionDataCount(s), 0);
  const tabify = form?.tabify ?? DEFAULT_TABIFY;

  const shouldTab = authoredSections >= 2 && (mode === 'tabbed' || dataCount >= tabify);
  if (!shouldTab) return tree;

  // Step 2 — promote top-level sections to tabs (source order preserved).
  const minTab = form?.min_tab_fields ?? DEFAULT_MIN_TAB_FIELDS;
  const out: LayoutTab[] = [];
  for (const section of sections) {
    if (section.key === '_main') {
      // Leading fields (before the first SectionBreak) → the synthetic General tab.
      out.push({ key: '_tab_general', label: '', sections: [{ ...section, label: '' }] });
    } else if (sectionDataCount(section) < minTab && out.length > 0) {
      // Too small to deserve its own tab → merge into the previous tab, keeping
      // its header label (renders as a sub-section within that tab).
      out[out.length - 1]!.sections.push(section);
    } else {
      // The section becomes its own tab; the tab title shows the label, so the
      // section's own header is blanked to avoid a duplicate heading.
      out.push({ key: section.key, label: section.label, sections: [{ ...section, label: '' }] });
    }
  }
  return out;
}

/**
 * Grid col-span class for a field, honoring an optional `columns` density cap
 * (`entity.form.columns`). An explicit per-field `span` always wins over the cap.
 *   3 (default) — intrinsic spans (4/6/12)
 *   2 — narrow fields (span 4) widen to half rows (6)
 *   1 — every field full-width (12)
 */
export function spanClass(field: FieldDefinition, columns?: 1 | 2 | 3): string {
  let span = fieldSpan(field);
  if (columns && !field.span) {
    if (columns === 1) span = 12;
    else if (columns === 2 && span === 4) span = 6;
  }
  return SPAN_CLASS[span];
}
