import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react';
import DOMPurify from 'dompurify';
import { Info, Snowflake, TriangleAlert } from 'lucide-react';
import { Badge, FormRow, FormSection, TabPanel, Tabs, Tooltip, cn } from '@digitaplatform/components';
import type { FieldDefinition, FormLayoutConfig } from '@digitaplatform/shared';
import { useI18nStore } from '@/stores/i18n';
import { fieldLabel } from '@/lib/localize-meta';
import { useChrome } from '@/lib/chrome-i18n';
import type { FieldControlState } from '@/controls/types';
import type { FieldStateMap } from '@/lib/evaluate-field';
import { SECTION_GRID_CLASS, computeLayout, duplicateFieldnames, spanClass, type LayoutSection } from './layout';
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
  /** Classes for the tab strip: the page that draws the form owns where the strip pins
   *  (`sticky` and its offset), because only the page knows what stands above the form. */
  tabsClassName?: string;
  /** The tab strip element, for the page that pins it to measure. */
  tabsRef?: Ref<HTMLDivElement>;
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
  tabsClassName,
  tabsRef,
}: FormRendererProps) {
  const formId = useId();
  const tSection = useI18nStore((s) => s.tSection);
  const tc = useChrome();

  const tabs = useMemo(() => computeLayout(fields, form), [fields, form]);
  useMemo(() => duplicateFieldnames(fields), [fields]);

  const [activeTab, setActiveTab] = useState<string>(tabs[0]?.key ?? '_details');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  // After every hook: a form whose fields arrive after its first render must call the same hooks
  // on both renders.
  if (tabs.length === 0) {
    return <p className="text-sm text-textMuted">{tc('ui.form.noFields')}</p>;
  }

  const current = tabs.find((t) => t.key === activeTab) ?? tabs[0]!;

  const sections = current.sections.map((section) => (
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
          cellClassName={cellClassName}
          onChange={(v) => onFieldChange(field.fieldname, v)}
        />
      )}
    />
  ));

  if (tabs.length === 1) return <div className="space-y-4">{sections}</div>;

  return (
    <div className="space-y-4">
      <Tabs
        ref={tabsRef}
        id={`${formId}-tabs`}
        // -mx-1/px-1 lets the focus ring of the first tab show.
        className={cn('-mx-1 px-1', tabsClassName)}
        value={current.key}
        onChange={setActiveTab}
        items={tabs.map((t) => {
          const errCount = errorsByTab[t.key] ?? 0;
          return {
            key: t.key,
            label: t.key === '_tab_general' ? tc('ui.form.tabGeneral') : tSection(entity, t.key, t.label || t.key),
            badge:
              errCount > 0 ? (
                <Badge variant="pill" size="sm" color="error" aria-label={`${errCount} error(s)`}>
                  {errCount}
                </Badge>
              ) : undefined,
          };
        })}
      />
      <TabPanel tabsId={`${formId}-tabs`} tabKey={current.key} className="space-y-4">
        {sections}
      </TabPanel>
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
  const label = section.label ? tSection(entity, section.key, section.label) : undefined;
  const cols = Math.min(Math.max(section.columns.length, 1), 3);

  return (
    <FormSection title={label} collapsible={section.collapsible} collapsed={collapsed} onToggle={onToggle}>
      {section.columns.length <= 1 ? (
        // Implicit single column → dense 12-track grid by intrinsic span (density-
        // capped via entity.form.columns). EVERY field renders — organization comes
        // from computeLayout (tabs/sections), never from hiding fields behind a bucket.
        <div className={SECTION_GRID_CLASS}>
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
      )}
    </FormSection>
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
  cellClassName,
  onChange,
}: {
  entity: string;
  field: FieldDefinition;
  value: unknown;
  doc: Record<string, unknown>;
  state: FieldControlState | undefined;
  error?: string;
  formId: string;
  cellClassName?: string;
  onChange: (v: unknown) => void;
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
    return <h4 className={cell('text-sm font-semibold text-textMain')}>{fieldLabel(field)}</h4>;
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
  const controlId = `${formId}-${field.fieldname}`;
  const labelId = `${controlId}-label`;
  const describedById = field.description ? `${controlId}-desc` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const invalid = s.invalid || !!error;
  const labelText = fieldLabel(field);

  return (
    <FormRow
      className={cellClassName}
      {...tid.field(entity, field.fieldname, field.fieldtype)}
      controlId={controlId}
      labelId={labelId}
      label={labelText}
      required={s.required}
      labelIcon={
        s.isFrozen ? <Snowflake className="ml-0.5 inline h-3 w-3 shrink-0 text-textMuted" aria-hidden="true" /> : undefined
      }
      // A2 · field.description behind an Info glyph instead of always-visible dev
      // prose under the control. Icon-only control ⇒ mandatory aria-label (= the
      // description, so accessible name == visible tooltip text, WCAG 2.5.3) + the
      // kit Tooltip for the visual hover/focus reveal. The full text also lives in
      // the sr-only <p> below (aria-describedby on the control).
      labelAction={
        field.description ? (
          <Tooltip label={field.description} multiline className="shrink-0">
            <button
              type="button"
              aria-label={field.description}
              className="inline-flex shrink-0 items-center rounded text-textMuted transition-colors duration-base ease-smooth hover:text-textMain focus-visible:text-textMain focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : undefined
      }
      error={error}
      errorId={errorId}
    >
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
    </FormRow>
  );
}
