import { describe, it, expect } from 'vitest';
import type { EntityDefinition } from '@digitaplatform/shared';
import { resolveWorkflowField } from '@/lib/workflow-field';

type M = Pick<EntityDefinition, 'workflow_field' | 'states' | 'transitions'>;

describe('resolveWorkflowField — no silent status assumption', () => {
  it('honors an explicit workflow_field', () => {
    expect(resolveWorkflowField({ workflow_field: 'stage' } as M)).toBe('stage');
  });
  it("uses the conventional 'status' only when a state machine is declared", () => {
    expect(resolveWorkflowField({ states: [{ value: 'a' }] } as unknown as M)).toBe('status');
    expect(resolveWorkflowField({ transitions: [{ from: 'a', to: 'b' }] } as unknown as M)).toBe('status');
  });
  it('returns null for an entity with no workflow — a plain `status` field is NOT a workflow', () => {
    expect(resolveWorkflowField({} as M)).toBeNull();
    expect(resolveWorkflowField({ states: [], transitions: [] } as unknown as M)).toBeNull();
  });
  it('explicit workflow_field wins even over a declared state machine', () => {
    expect(
      resolveWorkflowField({ workflow_field: 'phase', states: [{ value: 'x' }] } as unknown as M),
    ).toBe('phase');
  });
});
