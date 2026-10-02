"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { ModeButton, nextMode } from "@digitaplatform/components";
import { applyMode, rememberIdentityChoices, resolveInitialMode, type ThemeMode } from "@digitaplatform/theme";
import {
  IDENTITY_DELIVERED_EVENT,
  storeIdentityChoiceOnAccount,
  type DeliveredIdentitySources,
} from "@/lib/delivered-identity";

/**
 * The app's colour-mode button (the kit's ModeButton): light → dark → system. The mode is kept as
 * the app keeps it, under the app's key (one origin, one setting for website and app) and in the
 * person's look cookie, which every page reads first; `lookCookieDomain` is lookCookieDomain of the
 * tenant's sign-in address. It is applied through the theme runtime, which in `system` keeps
 * following the OS. The pre-paint identity boot set the initial class; this takes over from it.
 */
export function ThemeToggle({
  label,
  lookCookieDomain,
  identity,
}: {
  label: string;
  lookCookieDomain: string | undefined;
  /** Where a signed-in visitor's account keeps the choice, as the app's button keeps it. */
  identity: DeliveredIdentitySources;
}) {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const initial = resolveInitialMode();
    applyMode(initial);
    setMode(initial);
    // The account's choices arrive after the mount and paint the page again.
    const follow = () => setMode(resolveInitialMode());
    window.addEventListener(IDENTITY_DELIVERED_EVENT, follow);
    return () => window.removeEventListener(IDENTITY_DELIVERED_EVENT, follow);
  }, []);

  function cycle() {
    const next = nextMode(mode);
    try {
      rememberIdentityChoices({ mode: next }, lookCookieDomain);
    } catch {
      /* ignore storage failures (private mode) */
    }
    applyMode(next);
    setMode(next);
    storeIdentityChoiceOnAccount({ mode: next }, identity).catch((err: unknown) =>
      console.error("[identity] the mode could not be kept on the account", err),
    );
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
