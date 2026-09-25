import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { Input, Select, IconButton, Combobox } from '@digitaplatform/components';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { useSearchLink } from '@/hooks/useSearchLink';
import { FIELD_CLASS } from '@/controls/control-styles';
import type { FilterTuple } from '@/lib/filter-from-url';
import {
  filterableFields,
  operatorsForFieldtype,
  operatorArity,
  assertValidTuple,
  ADVANCED_OPERATORS,
  type FilterOp,
} from '@/lib/filter-operators';

/**
 * Build / edit ONE filter row: a field picker (filterableFields) → an operator
 * picker (operatorsForFieldtype, first = default) → a value control switched by
 * the operator's arity. PURE: no network. Emits a whitelisted [field, op, value]
 * tuple via onChange (validated by assertValidTuple — fail loud in dev if an
 * out-of-set op ever leaks) and onRemove for the trash button.
 *
 * Value controls by arity:
 *   single   → text / number / date / native Select (tOption) / Color / Link
 *              (typeahead picker, see LinkFilterValue) / Check toggle.
 *   range    → two inputs ([lo, hi]); typed number/date by fieldtype.
 *   multi    → comma-separated value entry (split to string[]).
 *   presence → none ("is" → set / not set toggle).
 *   boolean  → (Check) yes / no.
 */

const OP_KEY: Record<FilterOp, string> = {
  '=': 'ui.filter.op.eq',
  '!=': 'ui.filter.op.neq',
  '>': 'ui.filter.op.gt',
  '>=': 'ui.filter.op.gte',
  '<': 'ui.filter.op.lt',
  '<=': 'ui.filter.op.lte',
  in: 'ui.filter.op.in',
  'not in': 'ui.filter.op.notIn',
  like: 'ui.filter.op.like',
  'not like': 'ui.filter.op.notLike',
  between: 'ui.filter.op.between',
  is: 'ui.filter.op.is',
  regex: 'ui.filter.op.regex',
};

export interface FilterEditorProps {
  meta: EntityDefinition;
  /** The row being edited. A fresh row may carry an empty field/op pair. */
  filter: FilterTuple;
  onChange: (next: FilterTuple) => void;
  onRemove: () => void;
}

export function FilterEditor({ meta, filter, onChange, onRemove }: FilterEditorProps) {
  const tField = useI18nStore((s) => s.tField);
  const tOption = useI18nStore((s) => s.tOption);
  const tc = useChrome();

  const [fieldname, op, value] = filter;
  const fields = filterableFields(meta);
  const fieldDef = meta.fields.find((f) => f.fieldname === fieldname);

  // Operators valid for this field; "advanced" (regex) only when already selected.
  const allOps = fieldDef ? operatorsForFieldtype(fieldDef.fieldtype) : [];
  const ops = allOps.filter((o) => !ADVANCED_OPERATORS.has(o) || o === op);

  /** Default the value to the new arity when field/op changes. */
  function emit(nextField: string, nextOp: string, nextValue: unknown): void {
    const tuple: FilterTuple = [nextField, nextOp, nextValue];
    if (nextField && nextOp) assertValidTuple(tuple as [string, string, unknown]);
    onChange(tuple);
  }

  function onFieldChange(nextField: string): void {
    const nf = meta.fields.find((f) => f.fieldname === nextField);
    const nextOps = nf ? operatorsForFieldtype(nf.fieldtype) : [];
    const nextOp = nextOps[0] ?? '=';
    emit(nextField, nextOp, defaultValueFor(nf, nextOp));
  }

  function onOpChange(nextOp: string): void {
    emit(fieldname, nextOp, defaultValueFor(fieldDef, nextOp));
  }

  const arity = op ? operatorArity(op as FilterOp) : 'single';

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2 sm:flex-row sm:items-start">
      {/* Field picker */}
      <Select
        className="sm:w-44"
        aria-label={tc('ui.filter.field')}
        value={fieldname}
        onChange={onFieldChange}
        options={[
          { value: '', label: tc('ui.filter.selectField') },
          ...fields.map((f) => ({ value: f.fieldname, label: tField(meta.name, f.fieldname, f.label) })),
        ]}
      />

      {/* Operator picker */}
      <Select
        className="sm:w-36"
        aria-label={tc('ui.filter.operator')}
        value={op}
        disabled={!fieldDef}
        onChange={onOpChange}
        options={ops.map((o) => ({ value: o, label: OP_KEY[o] ? tc(OP_KEY[o]) : o }))}
      />

      {/* Value control (by arity) */}
      <div className="flex-1">
        <ValueControl
          meta={meta}
          field={fieldDef}
          arity={arity}
          value={value}
          tOption={tOption}
          tc={tc}
          onValue={(v) => emit(fieldname, op, v)}
        />
      </div>

      <IconButton
        label={tc('ui.filter.removeRow')}
        variant="danger"
        onClick={onRemove}
        wrapperClassName="shrink-0"
        icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
      />
    </div>
  );
}

/** The sensible empty value for a fieldtype + operator combination. */
function defaultValueFor(field: FieldDefinition | undefined, op: string): unknown {
  const arity = operatorArity(op as FilterOp);
  if (arity === 'presence') return 'set';
  if (arity === 'range') return ['', ''];
  if (arity === 'multi') return [];
  if (field?.fieldtype === 'Check') return 1;
  return '';
}

interface ValueControlProps {
  meta: EntityDefinition;
  field: FieldDefinition | undefined;
  arity: ReturnType<typeof operatorArity>;
  value: unknown;
  tOption: (entity: string, field: string, value: string) => string;
  tc: (key: string, params?: Record<string, string | number>) => string;
  onValue: (v: unknown) => void;
}

/**
 * Comma-separated multi-value entry (`in` / `not in`). Keeps the RAW typed text
 * in local state so a trailing comma isn't erased by an `arr.join`→split→filter
 * round-trip on every keystroke (H17). The parsed array is still emitted live;
 * the display re-syncs from the external value only while the field isn't focused.
 */
export function MultiValueInput({
  arr,
  numeric,
  ariaLabel,
  placeholder,
  onValue,
}: {
  arr: unknown[];
  numeric: boolean;
  ariaLabel: string;
  placeholder: string;
  onValue: (v: unknown) => void;
}) {
  const joined = arr.join(', ');
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(joined);
  useEffect(() => {
    if (!focused) setText(joined);
  }, [joined, focused]);
  return (
    <Input
      type="text"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onValue(
          e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => castScalar(s, numeric)),
        );
      }}
    />
  );
}

function ValueControl({ meta, field, arity, value, tOption, tc, onValue }: ValueControlProps) {
  if (!field) return null;
  const ft = field.fieldtype;
  const numeric = ['Int', 'Float', 'Currency', 'Percent', 'Rating', 'Duration'].includes(ft);
  const inputType = ft === 'Date' ? 'date' : ft === 'Datetime' ? 'datetime-local' : ft === 'Time' ? 'time' : numeric ? 'number' : ft === 'Color' ? 'color' : 'text';

  // presence → set / not set toggle.
  if (arity === 'presence') {
    return (
      <Select
        aria-label={tc('ui.filter.value')}
        value={value === 'not set' || value === false ? 'not set' : 'set'}
        onChange={onValue}
        options={[
          { value: 'set', label: tc('ui.filter.set') },
          { value: 'not set', label: tc('ui.filter.notSet') },
        ]}
      />
    );
  }

  // Check → yes / no.
  if (ft === 'Check') {
    return (
      <Select
        aria-label={tc('ui.filter.value')}
        value={value === 1 || value === true || value === '1' ? '1' : '0'}
        onChange={(v) => onValue(v === '1' ? 1 : 0)}
        options={[
          { value: '1', label: tc('ui.filter.yes') },
          { value: '0', label: tc('ui.filter.no') },
        ]}
      />
    );
  }

  // range (between) → two inputs.
  if (arity === 'range') {
    const arr = Array.isArray(value) ? value : ['', ''];
    return (
      <div className="flex items-center gap-2">
        <Input
          type={inputType}
          className="flex-1"
          aria-label={tc('ui.filter.rangeLow')}
          placeholder={tc('ui.filter.rangeLow')}
          value={arr[0] == null ? '' : String(arr[0])}
          onChange={(e) => onValue([castScalar(e.target.value, numeric), arr[1] ?? ''])}
        />
        <span className="text-textMuted">–</span>
        <Input
          type={inputType}
          className="flex-1"
          aria-label={tc('ui.filter.rangeHigh')}
          placeholder={tc('ui.filter.rangeHigh')}
          value={arr[1] == null ? '' : String(arr[1])}
          onChange={(e) => onValue([arr[0] ?? '', castScalar(e.target.value, numeric)])}
        />
      </div>
    );
  }

  // multi (in / not in) → comma-separated entry.
  if (arity === 'multi') {
    const arr = Array.isArray(value) ? value : [];
    // Select → multi native select; otherwise comma entry.
    if (ft === 'Select') {
      const opts = optionList(field.options);
      return (
        <select
          multiple
          className={`${FIELD_CLASS} h-24`}
          aria-label={tc('ui.filter.value')}
          value={arr.map(String)}
          onChange={(e) => onValue(Array.from(e.target.selectedOptions, (o) => o.value))}
        >
          {opts.map((o) => (
            <option key={o} value={o}>
              {tOption(meta.name, field.fieldname, o)}
            </option>
          ))}
        </select>
      );
    }
    return (
      <MultiValueInput
        arr={arr}
        numeric={numeric}
        ariaLabel={tc('ui.filter.value')}
        placeholder={tc('ui.filter.commaSeparated')}
        onValue={onValue}
      />
    );
  }

  // single → matching control.
  if (ft === 'Select') {
    const opts = optionList(field.options);
    return (
      <Select
        aria-label={tc('ui.filter.value')}
        value={value == null ? '' : String(value)}
        onChange={onValue}
        options={[
          { value: '', label: '—' },
          ...opts.map((o) => ({ value: o, label: tOption(meta.name, field.fieldname, o) })),
        ]}
      />
    );
  }

  if (ft === 'Color') {
    return (
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={tc('ui.filter.value')}
          className="h-9 w-12 cursor-pointer rounded-md border border-border bg-surface"
          value={typeof value === 'string' && value ? value : '#000000'}
          onChange={(e) => onValue(e.target.value)}
        />
        <Input
          type="text"
          className="flex-1"
          aria-label={tc('ui.filter.value')}
          value={value == null ? '' : String(value)}
          onChange={(e) => onValue(e.target.value)}
        />
      </div>
    );
  }

  // Link → typeahead picker against the target entity (falls back to a raw id input
  // for a Link without a declared target).
  if (ft === 'Link' && field.target) {
    return <LinkFilterValue field={field} value={value} tc={tc} onValue={onValue} />;
  }

  const placeholder =
    ft === 'Link' ? tc('ui.filter.linkIdPlaceholder', { entity: field.target ?? '' }) : tc('ui.filter.value');

  return (
    <Input
      type={inputType}
      aria-label={tc('ui.filter.value')}
      placeholder={placeholder}
      value={value == null ? '' : String(value)}
      onChange={(e) => onValue(castScalar(e.target.value, numeric))}
    />
  );
}

/**
 * Single-value Link filter input: the shared [[Combobox]] over useSearchLink —
 * the SAME implementation (and keyboard contract) as the form's LinkControl
 * inline mode, so filter pickers can never drift from form pickers again.
 * Self-contained (no form `doc`); a just-picked label shows immediately,
 * otherwise the stored id is displayed (filters carry no _link_titles).
 */
function LinkFilterValue({
  field,
  value,
  tc,
  onValue,
}: {
  field: FieldDefinition;
  value: unknown;
  tc: (key: string, params?: Record<string, string | number>) => string;
  onValue: (v: unknown) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const results = useSearchLink({
    entity: field.target,
    q: debounced,
    targetPath: field.target_path,
    filters: field.target_filters as Record<string, unknown> | undefined,
    enabled: open,
  });
  const options = (results.data ?? []).map((r) => ({
    id: r._id,
    label: r.display,
    subtitle: r.subtitle,
  }));

  const hasValue = value != null && value !== '';
  const currentDisplay = hasValue
    ? picked && picked.id === value
      ? picked.label
      : String(value)
    : '';

  return (
    <Combobox
      value={currentDisplay}
      query={query}
      onQueryChange={setQuery}
      options={options}
      loading={results.isLoading}
      open={open}
      onOpenChange={setOpen}
      onPick={(opt) => {
        setPicked({ id: opt.id, label: opt.label });
        onValue(opt.id);
      }}
      placeholder={field.target ? tc('ui.link.searchEntity', { entity: field.target }) : tc('ui.list.search')}
      loadingLabel={tc('ui.link.searching')}
      emptyLabel={tc('ui.select.noResults')}
      ariaLabel={tc('ui.filter.value')}
      onClear={
        hasValue
          ? () => {
              setPicked(null);
              onValue('');
              setQuery('');
            }
          : undefined
      }
      clearLabel={tc('ui.action.clear')}
    />
  );
}
function optionList(options: unknown): string[] {
  if (Array.isArray(options)) return options as string[];
  if (typeof options === 'string') return options.split('\n').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Coerce a numeric input string to a number; keep '' as '' (empty marker). */
function castScalar(raw: string, numeric: boolean): string | number {
  if (!numeric) return raw;
  if (raw === '') return '';
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}
