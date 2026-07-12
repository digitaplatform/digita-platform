import { useEffect, useId, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { ChevronDown, Info, Snowflake, TriangleAlert } from 'lucide-react';
import { Button, Card, Tooltip } from '@digitaplatform/components';
import type { FieldDefinition, FormLayoutConfig } from '@digitaplatform/shared';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import type { FieldControlState } from '@/controls/types';
import type { FieldStateMap } from '@/lib/evaluate-field';
import { computeLayout, duplicateFieldnames, spanClass, type LayoutSection } from './layout';
import { ControlRenderer } from './ControlRenderer';
import { tid } from '@/lib/testid';

/**
 * Pure presentation: walks the parsed layout tree and renders each field through
 * the control registry. Computes NOTHING about field state — `fieldState` arrives
 * precomputed from the Page sweep; the only upward channel is onFieldChange. Tabs
 * → scrollable strip; sections → responsive column grid (phone stacks, splits at
 * lg). Mobile-first via CSS only (no JS breakpoint here).
 */

interface FormRendererProps {
  entity: string;
  fields: FieldDefinition[];
  /** entity.form — steers the auto-layout engine; ignored when fields[] author a
   *  TabBreak/ColumnBreak (then the layout is fully hand-authored). */
  form?: FormLayoutConfig;
  doc: Record<string, unknown>;
  fieldState: FieldStateMap;
  errors: Record<string, string>;
  onFieldChange: (fieldname: string, value: unknown) => void;
  onButtonAction?: (fieldname: string) => void;
}

const DEFAULT_STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

const COL_LG: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
};

export function FormRenderer({
  entity,
  fields,
  form,
  doc,
  fieldState,
  errors,
  onFieldChange,
  onButtonAction,
}: FormRendererProps) {
  const formId = useId();
  const tField = useI18nStore((s) => s.tField);
  const tSection = useI18nStore((s) => s.tSection);
  const tc = useChrome();

  const tabs = useMemo(() => computeLayout(fields, form), [fields, form]);
  useMemo(() => duplicateFieldnames(fields), [fields]);

  const [activeTab, setActiveTab] = useState<string>(tabs[0]?.key ?? '_details');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (tabs.length === 0) {
    return <p className="text-sm text-textMuted">{tc('ui.form.noFields')}</p>;
  }

  const current = tabs.find((t) => t.key === activeTab) ?? tabs[0]!;

  // Count validation errors per tab (doc-driven Zod validates ALL fields, even
  // those on an unmounted tab) so the tab strip can surface where the problem is.
  const errorsByTab = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tabs) {
      let n = 0;
      for (const sec of t.sections)
        for (const col of sec.columns)
          for (const f of col.fields) if (errors[f.fieldname]) n++;
      counts[t.key] = n;
    }
    return counts;
  }, [tabs, errors]);

  // Auto-jump to the first erroring tab ONLY when the error SET actually changes
  // (e.g. a save was just rejected) — never on a manual tab switch, which would
  // otherwise bounce the user straight back and lock navigation onto the
  // erroring tab. The edited field's own error always lands on the active tab.
  const lastErrorSig = useRef<string>('');
  useEffect(() => {
    const sig = Object.keys(errors).sort().join('|');
    if (sig === lastErrorSig.current) return; // manual nav / unchanged errors → leave the user alone
    lastErrorSig.current = sig;
    if (!sig) return;
    if ((errorsByTab[activeTab] ?? 0) > 0) return;
    const firstBad = tabs.find((t) => (errorsByTab[t.key] ?? 0) > 0);
    if (firstBad && firstBad.key !== activeTab) setActiveTab(firstBad.key);
  }, [errors, errorsByTab, activeTab, tabs]);

  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <div
          data-ui="tabs"
          className="sticky top-14 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-border bg-surface px-1 [scrollbar-width:none]"
          role="tablist"
          aria-orientation="horizontal"
        >
          {tabs.map((t) => {
            const errCount = errorsByTab[t.key] ?? 0;
            const isActive = t.key === current.key;
            return (
              <button
                key={t.key}
                type="button"
                data-ui="tab"
                role="tab"
                id={`${formId}-tab-${t.key}`}
                aria-selected={isActive}
                aria-controls={`${formId}-panel-${t.key}`}
                onClick={() => setActiveTab(t.key)}
                className={
                  'inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-sm font-medium transition duration-base ease-smooth ' +
                  (isActive
                    ? 'border-primary-600 text-primary-600'
                    : errCount > 0
                      ? 'border-transparent text-error hover:text-error'
                      : 'border-transparent text-textMuted hover:text-textMain')
                }
              >
                {t.key === '_tab_general'
                  ? tc('ui.form.tabGeneral')
                  : tSection(entity, t.key, t.label || t.key)}
                {errCount > 0 && (
                  <span
                    className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold leading-none text-white"
                    aria-label={`${errCount} error(s)`}
                  >
                    {errCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div
        className="space-y-4"
        {...(tabs.length > 1
          ? {
              role: 'tabpanel',
              id: `${formId}-panel-${current.key}`,
              'aria-labelledby': `${formId}-tab-${current.key}`,
            }
          : {})}
      >
        {current.sections.map((section) => (
        <SectionBlock
          key={section.key}
          entity={entity}
          section={section}
          collapsed={!!(collapsed[section.key] ?? section.defaultCollapsed)}
          onToggle={() =>
            setCollapsed((c) => ({
              ...c,
              [section.key]: !(c[section.key] ?? section.defaultCollapsed),
            }))
          }
          columns={form?.columns}
          render={(field, cellClassName) => (
            <FieldSlot
              key={field.fieldname}
              entity={entity}
              field={field}
              value={doc[field.fieldname]}
              doc={doc}
              state={fieldState[field.fieldname]}
              error={errors[field.fieldname]}
              formId={formId}
              tField={tField}
              cellClassName={cellClassName}
              onChange={(v) => onFieldChange(field.fieldname, v)}
              onButtonAction={onButtonAction}
            />
          )}
        />
        ))}
      </div>
    </div>
  );
}

function SectionBlock({
  entity,
  section,
  collapsed,
  onToggle,
  columns,
  render,
}: {
  entity: string;
  section: LayoutSection;
  collapsed: boolean;
  onToggle: () => void;
  columns?: 1 | 2 | 3;
  render: (field: FieldDefinition, cellClassName?: string) => React.ReactNode;
}) {
  const tSection = useI18nStore((s) => s.tSection);
  const label = section.label ? tSection(entity, section.key, section.label) : '';
  const cols = Math.min(Math.max(section.columns.length, 1), 3);

  // Each section sits on a flat Card (bg-surface, rounded-card, density padding) like
  // the account cards — flat means no border/shadow, so it stays weightless.
  return (
    <Card>
      <section className="space-y-5">
      {label && (
        <header className="border-b border-border pb-3">
          {section.collapsible ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!collapsed}
              className="flex w-full items-center gap-2 text-sm font-semibold text-textMain transition-colors duration-base ease-smooth hover:text-textMain"
            >
              <span>{label}</span>
              <ChevronDown
                className={
                  'h-3.5 w-3.5 shrink-0 transition-transform duration-base ease-smooth ' +
                  (collapsed ? '-rotate-90' : '')
                }
                aria-hidden="true"
              />
            </button>
          ) : (
            <h3 className="text-sm font-semibold text-textMain">{label}</h3>
          )}
        </header>
      )}
      {!collapsed &&
        (section.columns.length <= 1 ? (
          // Implicit single column → dense 12-track grid by intrinsic span (density-
          // capped via entity.form.columns). EVERY field renders — organization comes
          // from computeLayout (tabs/sections), never from hiding fields behind a bucket.
          <div className="grid grid-cols-12 gap-x-8 gap-y-6">
            {(section.columns[0]?.fields ?? []).map((f) => render(f, spanClass(f, columns)))}
          </div>
        ) : (
          // Authored multi-column layout — rendered exactly as before.
          <div className={`grid grid-cols-1 gap-x-8 gap-y-6 ${COL_LG[cols]}`}>
            {section.columns.map((col, i) => (
              <div key={i} className="space-y-6">
                {col.fields.map((f) => render(f))}
              </div>
            ))}
          </div>
        ))}
      </section>
    </Card>
  );
}

function FieldSlot({
  entity,
  field,
  value,
  doc,
  state,
  error,
  formId,
  tField,
  cellClassName,
  onChange,
  onButtonAction,
}: {
  entity: string;
  field: FieldDefinition;
  value: unknown;
  doc: Record<string, unknown>;
  state: FieldControlState | undefined;
  error?: string;
  formId: string;
  tField: (entity: string, field: string, fallback?: string) => string;
  cellClassName?: string;
  onChange: (v: unknown) => void;
  onButtonAction?: (fieldname: string) => void;
}) {
  const tc = useChrome();
  // Grid-cell class (col-span) applied to this field's root in single-column sections;
  // undefined inside authored multi-column layouts (so those render exactly as before).
  const cell = (base: string) => (cellClassName ? `${cellClassName} ${base}` : base);
  // Fail-loud on a missing state entry — render visible + editable (never silently hide).
  let s = state;
  if (!s) {
    if (import.meta.env.DEV) console.error(`[FormRenderer] no field state for "${field.fieldname}"`);
    s = DEFAULT_STATE;
  }
  if (!s.visible) return null;

  // Non-control layout fields placed inside a column.
  if (field.fieldtype === 'Heading') {
    return <h4 className={cell('text-sm font-semibold text-textMain')}>{tField(entity, field.fieldname, field.label)}</h4>;
  }
  if (field.fieldtype === 'HTML') {
    const html = typeof field.options === 'string' ? field.options : field.description ?? '';
    return (
      <div
        className={cell('prose prose-sm max-w-none text-textMain')}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }) }}
      />
    );
  }
  if (field.fieldtype === 'Button') {
    const btn = (
      <Button type="button" variant="secondary" disabled={!onButtonAction} onClick={() => onButtonAction?.(field.fieldname)}>
        {tField(entity, field.fieldname, field.label)}
      </Button>
    );
    return cellClassName ? <div className={cellClassName}>{btn}</div> : btn;
  }

  const controlId = `${formId}-${field.fieldname}`;
  const labelId = `${controlId}-label`;
  const describedById = field.description ? `${controlId}-desc` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const invalid = s.invalid || !!error;
  const labelText = tField(entity, field.fieldname, field.label);

  return (
    <div className={cell('space-y-1')} {...tid.field(entity, field.fieldname, field.fieldtype)}>
      {/* Label row: the <label> itself (min-w-0 so its text still truncates) plus the
          A2 description affordance as a SIBLING — an interactive button must not nest
          inside a <label> (a label-click would forward to / toggle the control). */}
      <div className="flex items-center gap-0.5">
        <label
          id={labelId}
          htmlFor={controlId}
          className="flex min-w-0 items-center gap-0.5 text-sm font-medium text-textMain"
          title={labelText}
        >
          {/* Truncate only the text so a long label stays one line, while the required
              star + frozen snowflake stay visible; full text via the title tooltip. */}
          <span className="truncate">{labelText}</span>
          {s.required && <span className="text-error">*</span>}
          {s.isFrozen && (
            <Snowflake className="ml-0.5 inline h-3 w-3 shrink-0 text-textMuted" aria-hidden="true" />
          )}
        </label>
        {/* A2 · field.description behind an Info glyph instead of always-visible dev
            prose under the control. Icon-only control ⇒ mandatory aria-label (= the
            description, so accessible name == visible tooltip text, WCAG 2.5.3) + the
            kit Tooltip for the visual hover/focus reveal. The full text also lives in
            the sr-only <p> below (aria-describedby on the control). */}
        {field.description && (
          <Tooltip label={field.description} multiline className="shrink-0">
            <button
              type="button"
              aria-label={field.description}
              className="inline-flex shrink-0 items-center rounded text-textMuted transition-colors duration-base ease-smooth hover:text-textMain focus-visible:text-textMain focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </div>
      <ControlRenderer
        field={field}
        value={value}
        doc={doc}
        entity={entity}
        state={{ ...s, invalid }}
        onChange={onChange}
        error={error}
        controlId={controlId}
        labelId={labelId}
        describedById={describedById}
        errorId={errorId}
      />
      {/* Description kept in the DOM but visually hidden (A2): the visible reveal is now
          the Info glyph next to the label. Retained here (sr-only) so aria-describedby on
          the control (control-styles.ts describedBy) still resolves for screen readers. */}
      {field.description && (
        <p id={describedById} className="sr-only">
          {field.description}
        </p>
      )}
      {s.updating && <p className="text-sm text-textMuted">{tc('ui.status.updating')}</p>}
      {s.warning && (
        <p className="flex items-center gap-1 text-sm text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {s.warning}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
