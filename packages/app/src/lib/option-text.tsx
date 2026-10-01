import { createContext, useContext, type ReactNode } from 'react';
import { useI18nStore } from '@/stores/i18n';

type OptionText = (entity: string, field: string, value: string) => string;

/** The texts a form keys its Select options by. A record form keys them by its entity; a form that
 *  is the input of an action keys them by the action first, see ActionOptionTexts. */
const OptionTextPrefix = createContext<string | null>(null);

/**
 * Keys the options of the Select fields inside by `action_option.<Entity>.<action>.<field>.<value>`.
 * A dialog field is an input of the action and may share its name with an entity field whose
 * options read differently, the same reason its label keys by `action_field`. Without a key of its
 * own an option takes the text of the entity field of the same name.
 */
export function ActionOptionTexts({ entity, action, children }: { entity: string; action: string; children: ReactNode }) {
  return <OptionTextPrefix.Provider value={`action_option.${entity}.${action}`}>{children}</OptionTextPrefix.Provider>;
}

export function useOptionText(): OptionText {
  const prefix = useContext(OptionTextPrefix);
  const translations = useI18nStore((s) => s.translations);
  const tOption = useI18nStore((s) => s.tOption);
  return (entity, field, value) =>
    (prefix ? translations[`${prefix}.${field}.${value}`] : undefined) ?? tOption(entity, field, value);
}
