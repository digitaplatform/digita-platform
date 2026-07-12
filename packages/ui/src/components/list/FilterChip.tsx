import { X } from 'lucide-react';
import type { EntityDefinition } from '@digitaplatform/shared';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import type { FilterTuple } from '@/lib/filter-from-url';
import type { FilterOp } from '@/lib/filter-operators';
import { operatorArity } from '@/lib/filter-operators';

/**
 * A compact, removable chip rendering one active filter tuple as
 * "field op value". PURE: shows the tuple, calls onRemove on the × button.
 * The operator label is a localized ui.filter.op.* chrome key; the value is
 * formatted by arity (presence → "set"/"not set"; range → "lo – hi"; multi →
 * comma list; check → yes/no). NOT a fail-loud surface — out-of-set operators
 * are blocked at emit time (assertValidTuple), so here an unknown op just shows
 * its raw token rather than crashing a passive display.
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

export interface FilterChipProps {
  meta: EntityDefinition;
  filter: FilterTuple;
  onRemove: () => void;
}

export function FilterChip({ meta, filter, onRemove }: FilterChipProps) {
  const tField = useI18nStore((s) => s.tField);
  const tOption = useI18nStore((s) => s.tOption);
  const tc = useChrome();

  const [fieldname, op, value] = filter;
  const fieldDef = meta.fields.find((f) => f.fieldname === fieldname);
  const fieldLabel = tField(meta.name, fieldname, fieldDef?.label ?? fieldname);
  const opLabel = OP_KEY[op as FilterOp] ? tc(OP_KEY[op as FilterOp]!) : op;

  const arity = operatorArity(op as FilterOp);
  let valueLabel: string;
  if (arity === 'presence') {
    valueLabel = value === 'not set' || value === false ? tc('ui.filter.notSet') : tc('ui.filter.set');
  } else if (arity === 'range' && Array.isArray(value)) {
    valueLabel = `${fmt(value[0])} – ${fmt(value[1])}`;
  } else if (arity === 'multi' && Array.isArray(value)) {
    valueLabel = value.map((v) => optLabel(v)).join(', ');
  } else if (fieldDef?.fieldtype === 'Check') {
    valueLabel = value === 1 || value === true ? tc('ui.filter.yes') : tc('ui.filter.no');
  } else if (fieldDef?.fieldtype === 'Select') {
    valueLabel = optLabel(value);
  } else {
    valueLabel = fmt(value);
  }

  function fmt(v: unknown): string {
    if (v == null || v === '') return '∅';
    return String(v);
  }
  function optLabel(v: unknown): string {
    if (fieldDef?.fieldtype === 'Select') return tOption(meta.name, fieldname, String(v));
    return fmt(v);
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-subtle py-1 pl-3 pr-1 text-xs text-textMain">
      <span className="truncate">
        <span className="font-medium">{fieldLabel}</span>
        <span className="mx-1 text-textMuted">{opLabel}</span>
        {arity !== 'presence' && <span className="text-primary-700">{valueLabel}</span>}
        {arity === 'presence' && <span className="text-primary-700">{valueLabel}</span>}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={tc('ui.filter.removeChip', { field: fieldLabel })}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-textMuted hover:bg-border hover:text-textMain"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}
