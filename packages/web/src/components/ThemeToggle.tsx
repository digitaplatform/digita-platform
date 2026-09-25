"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { ModeButton, nextMode } from "@digitaplatform/components";
import { applyMode, resolveInitialMode, MODE_STORAGE_KEY, type ThemeMode } from "@digitaplatform/theme";

/**
 * The app's colour-mode button (the kit's ModeButton): light → dark → system. The mode is stored
 * under the app's key (one origin, one setting for website and app) and applied through the theme
 * runtime, which in `system` keeps following the OS. The pre-paint identity boot set the initial
 * class; this takes over from it.
 */
export function ThemeToggle({ label }: { label: string }) {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const initial = resolveInitialMode();
    applyMode(initial);
    setMode(initial);
  }, []);

  function cycle() {
    const next = nextMode(mode);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* ignore storage failures (private mode) */
    }
    applyMode(next);
    setMode(next);
  }

  return (
    <ModeButton
      mode={mode}
      onCycle={cycle}
      label={label}
      icons={{ light: <Sun className="h-5 w-5" />, dark: <Moon className="h-5 w-5" />, system: <Monitor className="h-5 w-5" /> }}
    />
  );
}
