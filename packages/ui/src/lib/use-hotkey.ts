import { useEffect } from 'react';

/**
 * Window-level hotkey. `meta:true` matches Cmd (mac) OR Ctrl. Always preventDefault
 * on a match. (Bare single-char keys are the caller's concern — guard against
 * input focus there; this hook is used for Cmd/Ctrl-K which fires unconditionally.)
 */
export function useHotkey(combo: { key: string; meta?: boolean }, handler: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const metaOk = !combo.meta || e.metaKey || e.ctrlKey;
      if (metaOk && e.key.toLowerCase() === combo.key.toLowerCase()) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo.key, combo.meta, handler]);
}
