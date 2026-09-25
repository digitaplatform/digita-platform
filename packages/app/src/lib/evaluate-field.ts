import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';
import { evaluateExpr, type EvalScope } from '@/lib/expression';

/**
 * The synchronous field-state engine. One linear O(n) pass re-derives every
 * field's {visible, required, readOnly, ...} from the whole-doc snapshot — every
 * expression reads `doc` directly, so there is no inter-field ordering dependency
 * (no fixpoint, no topo sort). Units consume `state` as a prop and subscribe to
 * nothing; the only upward channel is onChange → new doc → next sweep.
 *
 * Safe-degrade DIRECTION is constraint-preserving: a broken depends_on shows the
 * field (fail open); a broken mandatory_/read_only_depends_on requires / locks it
 * (fail closed). The parse error surfaces as `state.warning` (a visible chip).
 */

export interface FieldEvalContext {
  scope: EvalScope;
  /** entity.hooks.computed keys — authoritative, not a heuristic. */
  computedSet: Set<string>;
  /** snapshot/freeze field names (locked once submitted). */
  frozenSet: Set<string>;
  docstatus: number;
  /** entity.is_submittable — the docstatus lock only exists for submittable entities. */
  isSubmittable: boolean;
  /** fieldnames flagged allow_on_submit (the engine's post-submit mutation band). */
  allowOnSubmitSet: Set<string>;
  /** Whether this client has a legal write path for the band (updateSubmitted). v1:
   *  always false/undefined — the engine exposes NO HTTP verb for the band; it is only
   *  reachable server-side (transition / hooks / actions). Flip per-context once a
   *  submitted-patch endpoint ships. */
  postSubmitBandEditable?: boolean;
  isNew: boolean;
  /** perm-level write predicate (Administrator → always true). */
  canWriteLevel: (level: number) => boolean;
  /** Whole-form lock (e.g. submitted + no edit perm). */
  formDisabled?: boolean;
}

export type FieldStateMap = Record<string, FieldControlState>;

export function evaluateField(field: FieldDefinition, ctx: FieldEvalContext): FieldControlState {
  let warning: string | undefined;

  // Visibility — fail OPEN.
  let visible = !field.hidden;
  if (visible && field.depends_on) {
    const r = evaluateExpr(field.depends_on, ctx.scope);
    if (r.error) {
      visible = true;
      warning ??= r.error;
    } else {
      visible = r.value;
    }
  }

  // Required — fail CLOSED.
  let required = field.required ?? false;
  if (field.mandatory_depends_on) {
    const r = evaluateExpr(field.mandatory_depends_on, ctx.scope);
    if (r.error) {
      required = true;
      warning ??= r.error;
    } else {
      required = r.value;
    }
  }

  const isComputed = ctx.computedSet.has(field.fieldname);
  const isFrozen = ctx.frozenSet.has(field.fieldname);

  // Read-only — most-restrictive wins; broken read_only_depends_on locks (fail CLOSED).
  let readOnly = !!field.read_only;
  if (!readOnly && field.read_only_depends_on) {
    const r = evaluateExpr(field.read_only_depends_on, ctx.scope);
    if (r.error) {
      readOnly = true;
      warning ??= r.error;
    } else {
      readOnly = r.value;
    }
  }
  if (isComputed) readOnly = true;
  if (isFrozen && ctx.docstatus >= 1) readOnly = true;
  // Post-submit immutability (engine parity — DocStatusEngine.validateEdit): a
  // submitted (1) or cancelled (2) submittable doc is fully locked. The only
  // conceivable exemption is the allow_on_submit band at docstatus 1, and only when
  // the client has a legal write path for it — none in v1 (updateSubmitted has no
  // HTTP surface), so the exemption set is empty and the whole form locks.
  if (ctx.isSubmittable && ctx.docstatus >= 1) {
    const inBand =
      ctx.docstatus === 1 &&
      ctx.postSubmitBandEditable === true &&
      ctx.allowOnSubmitSet.has(field.fieldname);
    if (!inBand) readOnly = true;
  }
  if (field.set_only_once && !ctx.isNew) readOnly = true;
  if (!ctx.canWriteLevel(field.perm_level ?? 0)) readOnly = true;
  if (ctx.formDisabled) readOnly = true;

  return {
    visible,
    required,
    readOnly,
    invalid: false, // overlaid by the Page from RHF errors
    isComputed,
    isFrozen,
    updating: false, // overlaid by the Page during a /preview call
    warning,
  };
}

/** One sweep over all (non-layout) fields. */
export function sweepFieldStates(fields: FieldDefinition[], ctx: FieldEvalContext): FieldStateMap {
  const map: FieldStateMap = {};
  for (const f of fields) map[f.fieldname] = evaluateField(f, ctx);
  return map;
}

/** Row-scoped sweep for Table cells (wired in Phase 2 alongside the editable grid). */
export function sweepRowStates(
  childFields: FieldDefinition[],
  row: Record<string, unknown>,
  ctx: Omit<FieldEvalContext, 'scope'> & { user?: Record<string, unknown> },
): FieldStateMap {
  const scope: EvalScope = { doc: row, user: ctx.user };
  return sweepFieldStates(childFields, { ...ctx, scope });
}

/** Authoritative computed set — the engine ships `hooks.computed` in /meta verbatim. */
export function deriveComputedSet(entity: Pick<EntityDefinition, 'hooks'>): Set<string> {
  return new Set(Object.keys(entity.hooks?.computed ?? {}));
}

/** Fieldnames the engine's post-submit band admits (allow_on_submit === true). */
export function deriveAllowOnSubmitSet(entity: Pick<EntityDefinition, 'fields'>): Set<string> {
  return new Set(entity.fields.filter((f) => f.allow_on_submit === true).map((f) => f.fieldname));
}

/**
 * Fields locked once the doc is submitted (docstatus >= 1):
 *   - target field names of every entity.snapshot[*].fields
 *   - any top-level Table field that declares a non-empty per-row snapshot
 *   - `<linkField>_snapshot` + freeze.flatten[].as for each frozen Link
 */
export function deriveFrozenSet(entity: Pick<EntityDefinition, 'fields' | 'snapshot'>): Set<string> {
  const frozen = new Set<string>();
  for (const m of entity.snapshot ?? []) {
    for (const k of Object.keys(m.fields ?? {})) frozen.add(k);
  }
  for (const f of entity.fields) {
    if (
      f.fieldtype === 'Table' &&
      (f.snapshot ?? []).some((m) => Object.keys(m.fields ?? {}).length > 0)
    ) {
      frozen.add(f.fieldname);
    }
    if (f.fieldtype === 'Link' && f.freeze) {
      frozen.add(`${f.fieldname}_snapshot`);
      if (typeof f.freeze === 'object' && !Array.isArray(f.freeze) && f.freeze.flatten) {
        for (const fl of f.freeze.flatten) frozen.add(fl.as);
      }
    }
  }
  return frozen;
}
