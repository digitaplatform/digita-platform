import type { EntityDefinition, StateDefinition } from "@digitaplatform/shared";

/**
 * Resolve status color indicator for a document.
 */
export function resolveStatusIndicator(
  entity: EntityDefinition,
  data: Record<string, unknown>,
): { color: string } | undefined {
  if (!entity.states?.length) return undefined;

  // Prefer the explicit display override (timeline_field), then the workflow
  // field the workflow engine drives (workflow_field), then the conventional
  // "status". Keeps the status indicator in sync with getWorkflowField().
  const statusField = entity.timeline_field ?? entity.workflow_field ?? "status";
  const statusValue = data[statusField] as string;

  if (!statusValue) return undefined;

  const state = entity.states.find((s) => s.value === statusValue);
  return state ? { color: state.color } : undefined;
}
