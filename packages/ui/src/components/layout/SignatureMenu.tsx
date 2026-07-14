import { Signature } from 'lucide-react';
import { Menu, MenuItem } from '@digitaplatform/components';
import { SIGNATURE_LIST } from '@digitaplatform/theme';
import { useThemeStore } from '@/stores/theme';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Topbar signature picker: a labeled dropdown listing EVERY built-in signature
 * (`SIGNATURE_LIST` from `@digitaplatform/theme`) — never a hardcoded list, so
 * a newly-added signature appears here automatically with zero UI edits. A
 * signature is an IDENTITY overlay (accent + fonts + monogram) riding the
 * branding layer, so it COMPOSES with the active design instead of replacing
 * it. Reads the active signature from the theme store and applies it via
 * setSignature (persists to localStorage + roams via UserPreference).
 */
export function SignatureMenu() {
  const tc = useChrome();
  const signature = useThemeStore((s) => s.signature);
  const setSignature = useThemeStore((s) => s.setSignature);

  return (
    <Menu
      label={tc('ui.signature.label')}
      align="end"
      panelClassName="w-60"
      triggerClassName="rounded-md p-1.5 text-textMuted transition-colors duration-base ease-smooth hover:bg-bgHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      trigger={<Signature className="h-5 w-5" />}
    >
      {(close) =>
        SIGNATURE_LIST.map((s) => (
          <MenuItem
            key={s.id}
            checked={signature === s.id}
            className={signature === s.id ? 'text-textMain' : 'text-textMuted'}
            onSelect={() => {
              setSignature(s.id);
              close();
            }}
          >
            <span>{s.name}</span>
          </MenuItem>
        ))
      }
    </Menu>
  );
}
