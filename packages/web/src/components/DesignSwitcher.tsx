"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  applyDesign,
  DEFAULT_DESIGN_ID,
  DESIGN_STORAGE_KEY,
  DESIGNS,
  getRuntimeDesign,
  getRuntimeDesigns,
  resolveInitialDesign,
  subscribeRuntimeDesigns,
} from "@digitaplatform/theme";
import { cn } from "@digitaplatform/components";
import { loadDesignFromApps, type DeliveredIdentitySources } from "@/lib/delivered-identity";

/** The designs the band shows: the bundled default and the four premium design plugins. */
const SHOWCASED_DESIGNS = ["minimal", "editorial", "fluent", "ios", "material"];
const NO_DESIGNS: ReturnType<typeof getRuntimeDesigns> = [];

const PILL = "inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold transition-colors focus-visible:shadow-focus focus-visible:outline-none";

/**
 * The band above the footer that restyles the whole site with one of the platform's designs, the
 * choice kept in this browser under the app's key. A design the page has, bundled or already
 * delivered, applies at once. Another one is asked from the tenant's apps, whose composition for
 * the visitor decides; it applies only once its stylesheet loaded, and a refusal is said. Without
 * tenant apps such a design cannot arrive, so its button is disabled.
 */
export function DesignSwitcher(sources: DeliveredIdentitySources) {
  useSyncExternalStore(subscribeRuntimeDesigns, getRuntimeDesigns, () => NO_DESIGNS);
  const [stored, setStored] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => setStored(resolveInitialDesign()), []);

  const isOnPage = (id: string) => Boolean(DESIGNS[id] ?? getRuntimeDesign(id));
  // A stored design whose stylesheet is not on the page shows as the default, so the band says so.
  const active = stored && isOnPage(stored) ? stored : DEFAULT_DESIGN_ID;

  async function choose(id: string) {
    setRefused(null);
    if (!isOnPage(id)) {
      setLoading(id);
      const loaded = await loadDesignFromApps(id, sources).catch((err: unknown) => {
        console.error(`[design] "${id}" could not be asked from the tenant's apps`, err);
        return false;
      });
      setLoading(null);
      if (!loaded) {
        setRefused(id);
        return;
      }
    }
    applyDesign(id);
    try {
      localStorage.setItem(DESIGN_STORAGE_KEY, id);
    } catch {
      /* private mode: the design applies to this page view only */
    }
    setStored(id);
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-16 md:px-8">
      <div className="flex flex-col gap-5 rounded-card border border-border px-7 py-5 md:flex-row md:items-center md:gap-6">
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-semibold text-textMain">This site runs on digita. Switch the design.</p>
          <p className="text-textMuted">One click restyles the whole site; the choice stays in your browser.</p>
          {refused && (
            <p role="status" className="text-textMuted">
              The {refused} design is not available to you here.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 md:ml-auto">
          {SHOWCASED_DESIGNS.map((id) => {
            const reachable = isOnPage(id) || sources.apps.length > 0;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active === id}
                aria-busy={loading === id || undefined}
                disabled={!reachable || loading !== null}
                title={reachable ? undefined : "not bundled on this site"}
                onClick={() => choose(id)}
                className={cn(
                  PILL,
                  active === id ? "bg-primary-600 text-onPrimary" : "border border-borderStrong text-textMain hover:bg-bgHover",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {id}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
