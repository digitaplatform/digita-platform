import { Globe } from 'lucide-react';
import { Menu, MenuItem } from '@digitaplatform/components';
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
    <Menu
      label={tc('ui.lang.label')}
      align="end"
      panelClassName="w-56"
      triggerClassName="flex items-center gap-1 rounded-md p-1.5 text-textMuted transition-colors duration-base ease-smooth hover:bg-bgHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      trigger={
        <>
          <Globe className="h-5 w-5" aria-hidden="true" />
          <span className="text-xs font-medium uppercase">{current ?? ''}</span>
        </>
      }
    >
      {(close) =>
        languages.map((l) => (
          <MenuItem
            key={l.code}
            checked={l.code === current}
            onSelect={() => {
              void setLocale(l.code);
              close();
            }}
          >
            {`${l.flag_emoji ? `${l.flag_emoji} ` : ''}${l.native_name}`}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
