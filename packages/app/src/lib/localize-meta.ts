import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import type { EntitySummary } from '@/types';

/**
 * Generic meta localizer — the ONE seam where raw (English) metadata from the
 * engine is joined with the per-locale translation map (the i18n store). A single
 * pass replaces every label-bearing string by its canonical key, falling back to
 * the raw value: entity name + plural, field labels, section/tab headings, field
 * help-text (`description`) and action labels. Any future label field localizes
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

/** Localize a full EntityDefinition (label/plural/fields/sections/descriptions/actions). */
export function localizeMeta(meta: EntityDefinition, t: Dict): EntityDefinition {
  const e = meta.name;
  const out: EntityDefinition = {
    ...meta,
    label: t[`entity.${e}`] ?? meta.label,
    fields: meta.fields.map((f) => localizeField(e, f, t)),
  };
  if (meta.label_plural) out.label_plural = t[`entity_plural.${e}`] ?? meta.label_plural;
  if (meta.actions) {
    out.actions = meta.actions.map((a) => {
      const localized = { ...a, label: t[`action.${e}.${a.action}`] ?? a.label };
      if (a.params) {
        localized.params = a.params.map((p) => ({
          ...p,
          label: t[`action_param.${e}.${a.action}.${p.name}`] ?? p.label,
          ...(p.description
            ? { description: t[`action_param_desc.${e}.${a.action}.${p.name}`] ?? p.description }
            : {}),
        }));
      }
      return localized;
    });
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
