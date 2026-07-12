import { Palette } from 'lucide-react';
import { Menu, MenuItem } from '@digitaplatform/components';
import { DESIGN_LIST } from '@digitaplatform/theme';
import { useThemeStore } from '@/stores/theme';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Topbar design picker: a labeled dropdown listing EVERY registered design, read
 * straight from the `@digitaplatform/theme` registry (`DESIGN_LIST`) — never a hardcoded
 * list, so a newly-added design appears here automatically with zero UI edits.
 * Reads the active design from the theme store and applies it via setDesign
 * (persists to localStorage + roams via UserPreference).
 */
export function DesignMenu() {
  const tc = useChrome();
  const design = useThemeStore((s) => s.design);
  const setDesign = useThemeStore((s) => s.setDesign);

  return (
    <Menu
      label={tc('ui.design.label')}
      align="end"
      panelClassName="w-60"
      triggerClassName="rounded-md p-1.5 text-textMuted transition-colors duration-base ease-smooth hover:bg-bgHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      trigger={<Palette className="h-5 w-5" />}
    >
      {(close) =>
        DESIGN_LIST.map((d) => (
          <MenuItem
            key={d.id}
            checked={design === d.id}
            className={design === d.id ? 'text-textMain' : 'text-textMuted'}
            onSelect={() => {
              setDesign(d.id);
              close();
            }}
          >
            <span className="flex flex-col">
              <span>{d.name}</span>
              <span className="text-xs text-textMuted">{d.description}</span>
            </span>
          </MenuItem>
        ))
      }
    </Menu>
  );
}
