import { useSyncExternalStore } from 'react';
import { Signature } from 'lucide-react';
import { Menu, MenuItem } from '@digitaplatform/components';
import { getRuntimeSignatures, subscribeRuntimeSignatures } from '@digitaplatform/theme';
import { useThemeStore } from '@/stores/theme';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Topbar signature picker: lists every RUNTIME-registered signature — the
 * default `digita` (a free plugin bundled into the host) plus any delivered via
 * the plugin composition. It reads them reactively from the theme's runtime
 * signature registry (`useSyncExternalStore`), so a newly-registered signature
 * appears here with zero UI edits and none is ever hardcoded. A signature is an
 * IDENTITY overlay (accent + fonts + monogram) riding the branding layer, so it
 * COMPOSES with the active design instead of replacing it. Reads the active
 * signature from the theme store and applies a pick via setSignature (persists
 * to localStorage + roams via UserPreference).
 */
export function SignatureMenu() {
  const tc = useChrome();
  const signature = useThemeStore((s) => s.signature);
  const setSignature = useThemeStore((s) => s.setSignature);
  const signatures = useSyncExternalStore(
    subscribeRuntimeSignatures,
    getRuntimeSignatures,
    getRuntimeSignatures,
  );

  // Nothing registered yet → render no picker (never a dead, empty dropdown).
  if (signatures.length === 0) return null;

  return (
    <Menu
      label={tc('ui.signature.label')}
      align="end"
      panelClassName="w-60"
      triggerClassName="rounded-md p-1.5 text-textMuted transition-colors duration-base ease-smooth hover:bg-bgHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      trigger={<Signature className="h-5 w-5" />}
    >
      {(close) =>
        signatures.map((s) => (
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
