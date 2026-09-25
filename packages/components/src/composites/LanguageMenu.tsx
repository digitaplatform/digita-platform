import type { ReactNode } from 'react';
import { Menu, MenuItem } from './Menu.js';

export interface LanguageMenuProps {
  /** Accessible name of the menu and its trigger. */
  label: string;
  /** The active language code, shown beside the icon. */
  current?: string;
  /** The choices: the code and the label to show (a flag may lead it). */
  languages: readonly { code: string; label: string }[];
  onSelect: (code: string) => void;
  /** The trigger icon (a globe; the kit carries no icon library). */
  icon: ReactNode;
}

/**
 * The language picker of the chrome: a compact globe menu with the active code,
 * and radio items — the top bar stays one calm row of icon buttons. The caller
 * owns where the languages come from and what choosing one does.
 */
export function LanguageMenu({ label, current, languages, onSelect, icon }: LanguageMenuProps) {
  return (
    <Menu
      label={label}
      align="end"
      panelClassName="w-56"
      triggerClassName="flex items-center gap-1 rounded-md p-1.5 text-textMuted transition-colors duration-base ease-smooth hover:bg-bgHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      trigger={
        <>
          {icon}
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
              onSelect(l.code);
              close();
            }}
          >
            {l.label}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
