import { describe, it, expect } from 'vitest';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';
import { evaluateExpression } from '../../engine/src/core/expression/expression-evaluator';
import { hasRecordPermission, readableFieldPredicate } from '@/lib/permissions';
import type { SessionUser } from '@/types';

/**
 * A permission row's `condition` as the app judges it, against the engine's own evaluator. The app
 * holds less than the engine: the session user lacks the token's other claims, and a record lacks
 * the fields its reader may not read. Where the app cannot judge a condition from what it holds,
 * it leaves the row standing, so it never hides an action or a field the engine allows; where it
 * can, it answers what the engine answers.
 */

const session: SessionUser = { _id: 'u1', email: 'rita@example.com', roles: ['Reception'] };

interface ConditionCase {
  condition: string;
  /** The record the engine judges. */
  stored: Record<string, unknown>;
  /** The record the app holds, where its reader may not read every field. */
  shown?: Record<string, unknown>;
  /** Claims of the token the session user does not carry. */
  claims?: Record<string, unknown>;
  /** Whether the app can judge the condition from what it holds. */
  isJudged: boolean;
}

const cases: [string, ConditionCase][] = [
  ['a strict equality', { condition: "doc.status === 'draft'", stored: { status: 'draft' }, isJudged: false }],
  ['a strict inequality', { condition: "doc.status !== 'closed'", stored: { status: 'closed' }, isJudged: false }],
  ['arithmetic', { condition: 'doc.qty * doc.price > 100', stored: { qty: 2, price: 10 }, isJudged: false }],
  [
    'a token claim',
    { condition: 'doc.branch == user.branch', stored: { branch: 'North' }, claims: { branch: 'North' }, isJudged: false },
  ],
  [
    'a field the reader may not read',
    { condition: 'doc.margin > 100', stored: { status: 'open', margin: 500 }, shown: { status: 'open' }, isJudged: false },
  ],
  ['a field the record meets', { condition: "doc.status == 'open'", stored: { status: 'open' }, isJudged: true }],
  ['a field the record fails', { condition: "doc.status == 'open'", stored: { status: 'closed' }, isJudged: true }],
  [
    'a session attribute the record fails',
    { condition: 'doc.assignee == user.email', stored: { assignee: 'bob@example.com' }, isJudged: true },
  ],
];

function entity(permissions: EntityPermission[]): EntityDefinition {
  return { name: 'WorkOrder', fields: [], permissions } as unknown as EntityDefinition;
}

function engineAdmits({ condition, stored, claims }: ConditionCase): boolean {
  return evaluateExpression(condition, { doc: stored, user: { ...session, ...claims } }, false);
}

describe('a permission condition in the app and in the engine', () => {
  it.each(cases)('hasRecordPermission with %s', (_label, c) => {
    const meta = entity([{ role: 'Reception', level: 0, delete: 1, condition: c.condition }]);
    const app = hasRecordPermission(meta, session, 'delete', c.shown ?? c.stored);
    expect(app).toBe(c.isJudged ? engineAdmits(c) : true);
  });

  it.each(cases)('readableFieldPredicate with %s', (_label, c) => {
    const meta = entity([
      { role: 'Reception', level: 0, read: 1 },
      { role: 'Reception', level: 1, read: 1, condition: c.condition },
    ]);
    const app = readableFieldPredicate(meta, session, c.shown ?? c.stored)('cost', 1);
    expect(app).toBe(c.isJudged ? engineAdmits(c) : true);
  });

  it('meets cases the engine allows and cases it refuses', () => {
    const answers = cases.filter(([, c]) => c.isJudged).map(([, c]) => engineAdmits(c));
    expect(answers).toContain(true);
    expect(answers).toContain(false);
    expect(cases.filter(([, c]) => !c.isJudged).map(([, c]) => engineAdmits(c))).toContain(true);
  });
});
