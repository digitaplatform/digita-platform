import type { ActionDefinition, EntityDefinition, FieldDefinition, WorkspaceCard, WorkspaceDoc } from '@digitaplatform/shared';
import type { EntitySummary } from '@/types';

/**
 * Generic meta localizer — the ONE seam where raw (English) metadata from the
 * engine is joined with the per-locale translation map (the i18n store). A single
 * pass replaces every label-bearing string by its canonical key, falling back to
 * the raw value: entity name + plural, field labels, section/tab headings, field
 * help-text (`description`), action labels, the fields of an action's dialog
 * (`action_field.<Entity>.<action>.<field>`) and workflow transition labels
 * (`transition.<Entity>.<action>`). Any future label field localizes
 * by adding ONE line here — renderers read already-localized meta and never build
 * translation keys themselves.
 *
 * Wired into `useMeta` / `useMetaCatalog` / `useActions` so it runs reactively on
 * the active locale. Select OPTION values are the one exception: an `options`
 * string[] carries no label slot, so they stay resolved at the control via the
 * store's `tOption` (already localized).
 */

type Dict = Record<string, string>;

function localizeField(entity: string, f: FieldDefinition, t: Dict): FieldDefinition {
  const out: FieldDefinition = { ...f, label: t[`field.${entity}.${f.fieldname}`] ?? f.label };
  if (f.description) out.description = t[`description.${entity}.${f.fieldname}`] ?? f.description;
  if (Array.isArray(f.child_fields)) out.child_fields = f.child_fields.map((cf) => localizeField(entity, cf, t));
  return out;
}

/** A dialog field is keyed by its action, not by the entity: it is an input of the action and may
 *  share its name with an entity field that has another text. A table's columns add the table. */
function localizeDialogField(prefix: string, f: FieldDefinition, t: Dict): FieldDefinition {
  const key = `${prefix}.${f.fieldname}`;
  const out: FieldDefinition = { ...f, label: t[key] ?? f.label };
  if (Array.isArray(f.child_fields)) out.child_fields = f.child_fields.map((cf) => localizeDialogField(key, cf, t));
  return out;
}

/** Localize one action: its label, the inputs of a long-running one and the fields of its dialog.
 *  Exported for the actions the engine reports for a record, which never pass through localizeMeta. */
export function localizeAction(entity: string, a: ActionDefinition, t: Dict): ActionDefinition {
  const localized = { ...a, label: t[`action.${entity}.${a.action}`] ?? a.label };
  if (a.params) {
    localized.params = a.params.map((p) => ({
      ...p,
      label: t[`action_param.${entity}.${a.action}.${p.name}`] ?? p.label,
      ...(p.description
        ? { description: t[`action_param_desc.${entity}.${a.action}.${p.name}`] ?? p.description }
        : {}),
    }));
  }
  if (a.dialog_fields) {
    localized.dialog_fields = a.dialog_fields.map((f) => localizeDialogField(`action_field.${entity}.${a.action}`, f, t));
  }
  return localized;
}

/** Localize a full EntityDefinition (label/plural/fields/sections/descriptions/actions/transitions). */
export function localizeMeta(meta: EntityDefinition, t: Dict): EntityDefinition {
  const e = meta.name;
  const out: EntityDefinition = {
    ...meta,
    label: t[`entity.${e}`] ?? meta.label,
    fields: meta.fields.map((f) => localizeField(e, f, t)),
  };
  if (meta.label_plural) out.label_plural = t[`entity_plural.${e}`] ?? meta.label_plural;
  if (meta.actions) out.actions = meta.actions.map((a) => localizeAction(e, a, t));
  if (meta.transitions) {
    // The action is a transition's button text and the only name it has, so it keys its own text.
    // A transition without one is shown by its target state, which the state's own text translates.
    out.transitions = meta.transitions.map((tr) =>
      tr.action ? { ...tr, action: t[`transition.${e}.${tr.action}`] ?? tr.action } : tr,
    );
  }
  return out;
}

/** Localize a catalog summary (entity singular + plural label). */
export function localizeSummary(s: EntitySummary, t: Dict): EntitySummary {
  return {
    ...s,
    label: t[`entity.${s.name}`] ?? s.label,
    label_plural: t[`entity_plural.${s.name}`] ?? s.label_plural,
  };
}

/** Localize a workspace: its name and the texts of its cards. The keys name the workspace by its
 *  `_id` and a card by its `id`, the way the usermenu keys `user_menu.<_id>.label`. A links entry
 *  has no id, so its key names its position in `links`; reordering the entries moves their texts. */
export function localizeWorkspace(ws: WorkspaceDoc, t: Dict): WorkspaceDoc {
  const w = `workspace.${ws._id}`;
  return {
    ...ws,
    name: t[`${w}.name`] ?? ws.name,
    cards: ws.cards.map((card) => {
      const c = `${w}.card.${card.id}`;
      const out: WorkspaceCard = { ...card, label: t[`${c}.label`] ?? card.label };
      if (out.kind === 'shortcut' && out.description) out.description = t[`${c}.description`] ?? out.description;
      if (out.kind === 'links') {
        out.links = out.links.map((link, i) => ({ ...link, label: t[`${c}.link.${i}.label`] ?? link.label }));
      }
      return out;
    }),
  };
}
