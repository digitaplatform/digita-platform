import { describe, it, expect } from 'vitest';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import {
  evaluateField,
  deriveComputedSet,
  deriveFrozenSet,
  deriveAllowOnSubmitSet,
  type FieldEvalContext,
} from '@/lib/evaluate-field';

function field(f: Partial<FieldDefinition> & { fieldname: string }): FieldDefinition {
  return { fieldtype: 'Data', label: f.fieldname, ...f } as FieldDefinition;
}

function ctx(doc: Record<string, unknown>, over: Partial<FieldEvalContext> = {}): FieldEvalContext {
  return {
    scope: { doc, user: {} },
    computedSet: new Set(),
    frozenSet: new Set(),
    docstatus: 0,
    isSubmittable: false,
    allowOnSubmitSet: new Set(),
    isNew: true,
    canWriteLevel: () => true,
    ...over,
  };
}

describe('evaluateField — visibility', () => {
  it('hidden field is invisible', () => {
    expect(evaluateField(field({ fieldname: 'x', hidden: true }), ctx({})).visible).toBe(false);
  });
  it('depends_on drives visibility', () => {
    const f = field({ fieldname: 'x', depends_on: 'doc.show' });
    expect(evaluateField(f, ctx({ show: true })).visible).toBe(true);
    expect(evaluateField(f, ctx({ show: false })).visible).toBe(false);
  });
  it('broken depends_on fails OPEN + sets warning', () => {
    const s = evaluateField(field({ fieldname: 'x', depends_on: '(doc.a' }), ctx({}));
    expect(s.visible).toBe(true);
    expect(s.warning).toBeDefined();
  });
});

describe('evaluateField — required', () => {
  it('mandatory_depends_on overrides required', () => {
    const f = field({ fieldname: 'x', mandatory_depends_on: 'doc.need' });
    expect(evaluateField(f, ctx({ need: true })).required).toBe(true);
    expect(evaluateField(f, ctx({ need: false })).required).toBe(false);
  });
  it('broken mandatory_depends_on fails CLOSED (required)', () => {
    const s = evaluateField(field({ fieldname: 'x', mandatory_depends_on: '(doc.a' }), ctx({}));
    expect(s.required).toBe(true);
    expect(s.warning).toBeDefined();
  });
});

describe('evaluateField — readOnly precedence', () => {
  it('static read_only', () => {
    expect(evaluateField(field({ fieldname: 'x', read_only: true }), ctx({})).readOnly).toBe(true);
  });
  it('computed → read-only', () => {
    const s = evaluateField(field({ fieldname: 'x' }), ctx({}, { computedSet: new Set(['x']) }));
    expect(s.readOnly).toBe(true);
    expect(s.isComputed).toBe(true);
  });
  it('frozen only locks once submitted', () => {
    const f = field({ fieldname: 'x' });
    expect(evaluateField(f, ctx({}, { frozenSet: new Set(['x']), docstatus: 0 })).readOnly).toBe(false);
    expect(evaluateField(f, ctx({}, { frozenSet: new Set(['x']), docstatus: 1 })).readOnly).toBe(true);
  });
  it('set_only_once locks on an existing doc', () => {
    const f = field({ fieldname: 'x', set_only_once: true });
    expect(evaluateField(f, ctx({}, { isNew: true })).readOnly).toBe(false);
    expect(evaluateField(f, ctx({}, { isNew: false })).readOnly).toBe(true);
  });
  it('perm-write-strip locks a non-writable level', () => {
    const f = field({ fieldname: 'x', perm_level: 1 });
    const s = evaluateField(f, ctx({}, { canWriteLevel: (l) => l === 0 }));
    expect(s.readOnly).toBe(true);
  });
  it('broken read_only_depends_on fails CLOSED (locked)', () => {
    const s = evaluateField(field({ fieldname: 'x', read_only_depends_on: '(doc.a' }), ctx({}));
    expect(s.readOnly).toBe(true);
  });
});

describe('deriveComputedSet', () => {
  it('reads hooks.computed keys verbatim', () => {
    const e = { hooks: { computed: { total: 'h1', tax: 'h2' } } } as unknown as EntityDefinition;
    expect(deriveComputedSet(e)).toEqual(new Set(['total', 'tax']));
  });
  it('empty when no hooks', () => {
    expect(deriveComputedSet({} as EntityDefinition)).toEqual(new Set());
  });
});

describe('deriveFrozenSet', () => {
  it('collects snapshot target fields, snapshot-bearing tables, and frozen links', () => {
    const e = {
      snapshot: [{ from: 'owner', fields: { owner_name_at_doc: 'display_name' } }],
      fields: [
        field({ fieldname: 'lines', fieldtype: 'Table', snapshot: [{ from: 'p', fields: { x: 'y' } }] }),
        field({ fieldname: 'owner', fieldtype: 'Link', freeze: true }),
        field({
          fieldname: 'ref',
          fieldtype: 'Link',
          freeze: { flatten: [{ from: 'code', as: 'ref_code_at_doc' }] },
        }),
      ],
    } as unknown as EntityDefinition;
    const frozen = deriveFrozenSet(e);
    expect(frozen.has('owner_name_at_doc')).toBe(true);
    expect(frozen.has('lines')).toBe(true);
    expect(frozen.has('owner_snapshot')).toBe(true);
    expect(frozen.has('ref_snapshot')).toBe(true);
    expect(frozen.has('ref_code_at_doc')).toBe(true);
  });
});

describe('evaluateField — post-submit lock (engine parity)', () => {
  it('submittable + docstatus 1 locks a plain field; docstatus 0 leaves it editable', () => {
    const f = field({ fieldname: 'x' });
    expect(evaluateField(f, ctx({}, { isSubmittable: true, docstatus: 0 })).readOnly).toBe(false);
    expect(evaluateField(f, ctx({}, { isSubmittable: true, docstatus: 1 })).readOnly).toBe(true);
  });
  it('allow_on_submit field stays locked at docstatus 1 while there is no band write path (v1)', () => {
    const f = field({ fieldname: 'x' });
    const over = { isSubmittable: true, docstatus: 1, allowOnSubmitSet: new Set(['x']) };
    expect(evaluateField(f, ctx({}, over)).readOnly).toBe(true); // no postSubmitBandEditable
    expect(evaluateField(f, ctx({}, { ...over, postSubmitBandEditable: true })).readOnly).toBe(false);
  });
  it('cancelled (docstatus 2) is fully locked even with a band-editable client', () => {
    const f = field({ fieldname: 'x' });
    const s = evaluateField(
      f,
      ctx({}, {
        isSubmittable: true,
        docstatus: 2,
        allowOnSubmitSet: new Set(['x']),
        postSubmitBandEditable: true,
      }),
    );
    expect(s.readOnly).toBe(true);
  });
  it('NON-submittable entity is never docstatus-locked (parity)', () => {
    const f = field({ fieldname: 'x' });
    expect(evaluateField(f, ctx({}, { isSubmittable: false, docstatus: 1 })).readOnly).toBe(false);
  });
  it('deriveAllowOnSubmitSet picks exactly the flagged fields', () => {
    const entity = {
      fields: [
        field({ fieldname: 'a', allow_on_submit: true }),
        field({ fieldname: 'b' }),
        field({ fieldname: 'c', allow_on_submit: true }),
      ],
    } as unknown as EntityDefinition;
    expect([...deriveAllowOnSubmitSet(entity)].sort()).toEqual(['a', 'c']);
  });
});
