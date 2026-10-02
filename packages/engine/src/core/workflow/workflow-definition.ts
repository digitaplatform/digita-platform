import type { EntityDefinition } from "@digitaplatform/shared";

/**
 * What makes an entity's workflow inconsistent: several `is_initial` states, or a transition whose
 * `from` or `to` names no declared state. Empty for a consistent workflow and for none. A terminal
 * state may have a declared way out (a Reopen); the runtime honors it, so it is no problem here.
 */
export function workflowDefinitionProblems(entity: EntityDefinition): string[] {
  const out: string[] = [];
  const states = entity.states ?? [];
  const transitions = entity.transitions ?? [];
  if (states.length === 0 && transitions.length === 0) return out;
  const stateValues = new Set(states.map((s) => s.value));

  const initial = states.filter((s) => s.is_initial);
  if (initial.length > 1) {
    out.push(`multiple is_initial states: ${initial.map((s) => s.value).join(", ")}`);
  }
  for (const t of transitions) {
    if (t.from !== "*" && !stateValues.has(t.from)) out.push(`transition.from "${t.from}" is not a declared state`);
    if (!stateValues.has(t.to)) out.push(`transition.to "${t.to}" is not a declared state`);
  }
  return out;
}
