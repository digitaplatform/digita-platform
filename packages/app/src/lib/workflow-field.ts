import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * The field that carries an entity's workflow state — resolved WITHOUT a silent
 * domain assumption. An entity opts into a workflow by declaring an explicit
 * `workflow_field`, or a state machine (`states[]` / `transitions[]`), in which case
 * the conventional field name is `status`. An entity that declares NONE of these has
 * no workflow field at all → returns null. A plain field that merely happens to be
 * named `status` (with no states/transitions) must therefore NOT be rendered as a
 * workflow badge or anchor transitions — that is the difference between "the engine's
 * generic `workflow_field ?? status` default when a workflow exists" and blindly
 * assuming every `status` field is a workflow.
 */
export function resolveWorkflowField(
  meta: Pick<EntityDefinition, 'workflow_field' | 'states' | 'transitions'>,
): string | null {
  if (meta.workflow_field) return meta.workflow_field;
  if ((meta.states?.length ?? 0) > 0 || (meta.transitions?.length ?? 0) > 0) return 'status';
  return null;
}
