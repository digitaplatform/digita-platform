import { Card, Skeleton, cn } from '@digitaplatform/components';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { computeLayout, spanClass, type LayoutSection } from './layout';

/**
 * Meta-aware record load skeleton (BUG-2 reflow fix). The plain <FormSkeleton> is a
 * generic 8-bar grid with no header/tabs/Card frame — so when the real record settles,
 * the whole column jumps. This skeleton instead derives the SAME geometry the
 * FormRenderer will paint, straight from metadata via `computeLayout` + `spanClass`:
 * a header block, a tab strip when the layout tabs, Card-framed sections, and a bar per
 * field whose height matches that field's real control (Text/SmallText → the 5.5rem
 * textarea, Check → the switch pill, everything else → the shared control height). It is
 * fully metadata-driven (no app/ERP knowledge), so every app inherits a zero-shift load.
 *
 * Used at RecordPage once meta is known but the document is still loading; the doc's
 * values are unknown, so depends_on visibility can't be resolved — statically hidden
 * fields are dropped and the active (first) tab is shown, which is what settles in.
 */

const COL_LG: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
};

/** Deterministic label-bar width (index-derived) so bars don't look machine-stamped. */
const labelW = (i: number) => (i % 3 === 0 ? 'w-1/3' : 'w-1/4');

/** The control-shaped bar for one field, height matched to its real control. */
function ControlBar({ field }: { field: FieldDefinition }) {
  const ft = field.fieldtype;
  // Multi-line note → the same 5.5rem the textarea occupies (the biggest single
  // settle-time jump this skeleton removes: 36px bar → 88px control).
  if (ft === 'Text' || ft === 'SmallText') {
    return <Skeleton className="h-[5.5rem] w-full rounded-input" />;
  }
  // Boolean → Switch: a small pill, not a full-width control bar.
  if (ft === 'Check') {
    return <Skeleton className="h-6 w-11 rounded-full" />;
  }
  // Every other single-line control settles at the shared control height.
  return <Skeleton className="h-[var(--control-h,2.625rem)] w-full rounded-input" />;
}

/** One field cell — mirrors FieldSlot: layout decorations render bare, data fields get
 *  a label bar above the control bar. `cellClassName` carries the grid col-span (only in
 *  single-implicit-column sections, exactly like the FormRenderer). */
function FieldCell({
  field,
  index,
  cellClassName,
}: {
  field: FieldDefinition;
  index: number;
  cellClassName?: string;
}) {
  const ft = field.fieldtype;
  if (ft === 'HTML') return null; // arbitrary embedded content — unpredictable, omit
  if (ft === 'Heading') {
    return <Skeleton className={cn('h-4 w-1/3', cellClassName)} />;
  }
  if (ft === 'Button') {
    return (
      <div className={cellClassName}>
        <Skeleton className="h-[var(--control-h,2.625rem)] w-28 rounded-btn" />
      </div>
    );
  }
  return (
    <div className={cn('space-y-1.5', cellClassName)}>
      <Skeleton className={cn('h-3', labelW(index))} />
      <ControlBar field={field} />
    </div>
  );
}

/** A Card-framed section — mirrors SectionBlock: optional header bar, then either the
 *  dense 12-track grid (single implicit column) or the authored multi-column stack. */
function SectionSkeleton({ section, columns }: { section: LayoutSection; columns?: 1 | 2 | 3 }) {
  // Doc values are unknown at load; drop statically-hidden fields (the common case).
  const visible = (fields: FieldDefinition[]) => fields.filter((f) => !f.hidden);
  const cols = Math.min(Math.max(section.columns.length, 1), 3);
  return (
    <Card>
      <section className="space-y-5">
        {section.label && (
          <header className="border-b border-border pb-3">
            <Skeleton className="h-4 w-40" />
          </header>
        )}
        {section.columns.length <= 1 ? (
          <div className="grid grid-cols-12 gap-x-8 gap-y-6">
            {visible(section.columns[0]?.fields ?? []).map((f, i) => (
              <FieldCell key={f.fieldname} field={f} index={i} cellClassName={spanClass(f, columns)} />
            ))}
          </div>
        ) : (
          <div className={`grid grid-cols-1 gap-x-8 gap-y-6 ${COL_LG[cols]}`}>
            {section.columns.map((col, ci) => (
              <div key={ci} className="space-y-6">
                {visible(col.fields).map((f, i) => (
                  <FieldCell key={f.fieldname} field={f} index={i} />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </Card>
  );
}

export function RecordSkeleton({ meta }: { meta: EntityDefinition }) {
  const tabs = computeLayout(meta.fields, meta.form);
  const current = tabs[0];
  return (
    <div className="w-full space-y-4 pb-24" aria-hidden="true">
      {/* Header: eyebrow + title-height bar + status pill, and the action cluster on the
          right — the frame that <FormSkeleton> lacked, so the column no longer shifts. */}
      <header className="flex items-start justify-between border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-[var(--control-h,2.625rem)] w-24 rounded-btn" />
          <Skeleton className="h-[var(--control-h,2.625rem)] w-24 rounded-btn" />
        </div>
      </header>

      <div className="space-y-4">
        {tabs.length > 1 && (
          <div className="flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <Skeleton key={t.key} className="h-9 w-24" />
            ))}
          </div>
        )}
        {current?.sections.map((section) => (
          <SectionSkeleton key={section.key} section={section} columns={meta.form?.columns} />
        ))}
      </div>
    </div>
  );
}
