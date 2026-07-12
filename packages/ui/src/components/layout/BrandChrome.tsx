import { X, PanelLeft, PanelLeftClose } from 'lucide-react';
import type { RegionSide } from '@digitaplatform/plugins';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';

interface BrandChromeProps {
  /** Where the host region docks — drives vertical (rail) vs horizontal (bar) chrome. */
  side: RegionSide;
  /** Rail is desktop-collapsed (narrow) — hide the app name, show only the expand toggle. */
  collapsed?: boolean;
  /** Show the desktop collapse/expand toggle. */
  collapsible?: boolean;
  onToggleCollapse?: () => void;
  /** Show the close button (mobile drawer only). */
  onClose?: () => void;
}

/**
 * The single brand-chrome unit: logo (or a monogram) + app name, sourced from
 * the branding payload (→ platform name → "Digita"). Rendered by the shell
 * wherever a region declares `brand: true`. Vertical header for left/right
 * rails; compact inline variant for top/bottom bars.
 */
export function BrandChrome({ side, collapsed, collapsible, onToggleCollapse, onClose }: BrandChromeProps) {
  const tc = useChrome();
  const branding = useSessionStore((s) => s.branding);
  const platformName = useSessionStore((s) => s.settings?.platform_name);
  const appName = branding?.app_name ?? platformName ?? 'Digita';

  const logo = branding?.logo ? (
    <img src={branding.logo} alt="" className="h-7 w-7 shrink-0 rounded" />
  ) : (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary-600 text-sm font-bold text-white">
      {appName.charAt(0).toUpperCase()}
    </div>
  );

  // Top/bottom bar: compact, inline, no border (the bar owns its border).
  if (side === 'top' || side === 'bottom') {
    return (
      <div className="flex shrink-0 items-center gap-2 px-2">
        {logo}
        <span className="truncate text-sm font-semibold text-textMain">{appName}</span>
      </div>
    );
  }

  // Left/right rail: an h-14 header row matching the topbar height.
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      {collapsed ? (
        <button
          type="button"
          className="mx-auto rounded p-1.5 text-textMuted hover:bg-subtle"
          onClick={onToggleCollapse}
          aria-label={tc('ui.nav.expand')}
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      ) : (
        <>
          {logo}
          <span className="flex-1 truncate text-sm font-semibold text-textMain">{appName}</span>
          {onClose && (
            <button
              type="button"
              className="rounded p-1 text-textMuted hover:bg-subtle lg:hidden"
              onClick={onClose}
              aria-label={tc('ui.nav.close')}
            >
              <X className="h-5 w-5" />
            </button>
          )}
          {collapsible && onToggleCollapse && (
            <button
              type="button"
              className="hidden rounded p-1 text-textMuted hover:bg-subtle lg:inline-flex"
              onClick={onToggleCollapse}
              aria-label={tc('ui.nav.collapse')}
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
