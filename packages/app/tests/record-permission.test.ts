import { describe, it, expect } from 'vitest';
import type { EntityDefinition } from '@digitaplatform/shared';
import { hasRecordPermission } from '@/lib/permissions';
import type { SessionUser } from '@/types';

/**
 * hasRecordPermission answers what the engine's PermissionChecker.hasPermission answers for a
 * stored record: a level-0 row of one of the user's roles sets the bit, the record's workflow
 * state does not strip it from that row's role, and the row's if_owner, condition and scope
 * admit the record.
 */

const reception: SessionUser = { _id: 'u1', email: 'rita@example.com', roles: ['Reception'] };

function workOrder(extra: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: 'WorkOrder',
    fields: [],
    permissions: [{ role: 'Reception', level: 0, read: 1, write: 1, create: 1 }],
    states: [
      { value: 'open', color: 'blue' },
      { value: 'in_repair', color: 'amber', permissions: [{ role: 'Reception', write: 0, create: 0 }] },
    ],
    ...extra,
  } as unknown as EntityDefinition;
}

describe('hasRecordPermission and workflow state strips', () => {
  it('refuses an action the record state strips from the only granting role', () => {
    expect(hasRecordPermission(workOrder(), reception, 'write', { status: 'in_repair' })).toBe(false);
  });

  it('grants the action in a state without a strip', () => {
    expect(hasRecordPermission(workOrder(), reception, 'write', { status: 'open' })).toBe(true);
  });

  it('reads the state from the declared workflow_field', () => {
    const meta = workOrder({ workflow_field: 'stage' });
    expect(hasRecordPermission(meta, reception, 'write', { stage: 'in_repair', status: 'open' })).toBe(false);
  });

  it('lets a state strip only read, write, submit, cancel and delete, as the engine does', () => {
    expect(hasRecordPermission(workOrder(), reception, 'create', { status: 'in_repair' })).toBe(true);
  });

  it('counts only the first strip a state names for a role, as the engine does', () => {
    const meta = workOrder({
      states: [
        {
          value: 'in_repair',
          color: 'amber',
          permissions: [
            { role: 'Reception', write: 1 },
            { role: 'Reception', write: 0 },
          ],
        },
      ],
    });
    expect(hasRecordPermission(meta, reception, 'write', { status: 'in_repair' })).toBe(true);
  });

  it('never grants through a row above level 0', () => {
    const meta = workOrder({ permissions: [{ role: 'Reception', level: 1, read: 1, write: 1 }] });
    expect(hasRecordPermission(meta, reception, 'write', { status: 'open' })).toBe(false);
  });

  it('lets Administrator act in every state', () => {
    const admin: SessionUser = { _id: 'a1', email: 'admin@example.com', roles: ['Administrator'] };
    expect(hasRecordPermission(workOrder(), admin, 'write', { status: 'in_repair' })).toBe(true);
  });
});

describe('hasRecordPermission and the gates of a row', () => {
  it('leaves to the engine a row whose condition the app cannot read', () => {
    const meta = workOrder({
      permissions: [{ role: 'Reception', level: 0, delete: 1, condition: "eval:(doc.status == 'open'" }],
    });
    expect(hasRecordPermission(meta, reception, 'delete', { status: 'closed' })).toBe(true);
  });

  it('refuses through a scoped row where the session holds an empty value for the scope', () => {
    const meta = workOrder({
      permissions: [{ role: 'Reception', level: 0, delete: 1, scope: { field: 'branch', user_field: 'branch' } }],
    });
    const withoutBranch = { ...reception, branch: null } as unknown as SessionUser;
    expect(hasRecordPermission(meta, withoutBranch, 'delete', { branch: 'North' })).toBe(false);
    const north = { ...reception, branch: 'North' } as unknown as SessionUser;
    expect(hasRecordPermission(meta, north, 'delete', { branch: 'North' })).toBe(true);
  });
});
