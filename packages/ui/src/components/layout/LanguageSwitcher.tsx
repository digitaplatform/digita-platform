import { Globe } from 'lucide-react';
import { LanguageMenu } from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Language picker driven entirely by the BACKEND: the options are the engine's
 * Language entities (from /boot.available_languages) and switching reloads that
 * locale's backend translations. Hidden when the platform disallows user language
 * choice or only one language exists.
 *
 * Nordstern F15: a compact globe menu (kit Menu/MenuItem radio items) instead of
 * a 176px Select box — the topbar stays one calm row of icon buttons.
 */
export function LanguageSwitcher() {
  const tc = useChrome();
  const languages = useSessionStore((s) => s.languages);
  const allow = useSessionStore((s) => s.allowUserLanguage);
  const current = useSessionStore((s) => s.locale?.code);
  const setLocale = useSessionStore((s) => s.setLocale);

  if (!allow || languages.length < 2) return null;

  return (
    <LanguageMenu
      label={tc('ui.lang.label')}
      current={current}
      icon={<Globe className="h-5 w-5" aria-hidden="true" />}
      languages={languages.map((l) => ({ code: l.code, label: `${l.flag_emoji ? `${l.flag_emoji} ` : ''}${l.native_name}` }))}
      onSelect={(code) => void setLocale(code)}
    />
  );
}
