import type { ReactNode } from 'react';
import { topBarButtonClass } from './TopBar.js';

type Mode = 'light' | 'dark' | 'system';

/** The order the button cycles the colour mode in. */
export const MODE_CYCLE: readonly Mode[] = ['light', 'dark', 'system'];

/** The mode after `mode` in MODE_CYCLE. */
export function nextMode(mode: Mode): Mode {
  return MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length]!;
}

/**
 * The top bar's colour-mode button: it shows the active mode's icon and asks for
 * the next one on click (light → dark → system). The icons are passed in (the kit
 * carries no icon library); the caller applies and stores the mode.
 */
export function ModeButton({
  mode,
  onCycle,
  label,
  icons,
}: {
  mode: Mode;
  onCycle: () => void;
  label: string;
  icons: Record<Mode, ReactNode>;
}) {
  return (
    <button type="button" className={topBarButtonClass} onClick={onCycle} aria-label={label} title={`${label} — ${mode}`}>
      {icons[mode]}
    </button>
  );
}
