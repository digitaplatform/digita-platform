import { AlignVerticalSpaceAround } from 'lucide-react';
import { Menu, MenuItem } from '@digitaplatform/components';
import type { Density } from '@digitaplatform/theme';
import { useThemeStore } from '@/stores/theme';
import { useChrome } from '@/lib/chrome-i18n';

const OPTIONS: Density[] = ['comfortable', 'compact', 'spacious'];

/**
 * Topbar UI-density picker: a labeled dropdown (Comfortable / Compact / Spacious)
 * with a check on the active option. Built on the generic Menu primitive; reads
 * the density from the theme store and applies it via setDensity.
 */
export function DensityMenu() {
  const tc = useChrome();
  const density = useThemeStore((s) => s.density);
  const setDensity = useThemeStore((s) => s.setDensity);

  return (
    <Menu
      label={tc('ui.density.label')}
      align="end"
      panelClassName="w-48"
      triggerClassName="rounded-md p-1.5 text-textMuted transition-colors duration-base ease-smooth hover:bg-bgHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      trigger={<AlignVerticalSpaceAround className="h-5 w-5" />}
    >
      {(close) =>
        OPTIONS.map((opt) => (
          <MenuItem
            key={opt}
            checked={density === opt}
            className={density === opt ? 'text-textMain' : 'text-textMuted'}
            onSelect={() => {
              setDensity(opt);
              close();
            }}
          >
            {tc(`ui.density.${opt}`)}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
