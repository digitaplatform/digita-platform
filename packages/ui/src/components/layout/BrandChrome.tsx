import { X, PanelLeft, PanelLeftClose } from 'lucide-react';
import type { RegionSide } from '@digitaplatform/plugins';
import { getSignature } from '@digitaplatform/theme';
import { BrandMark, cn, railButtonClass } from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import { useThemeStore } from '@/stores/theme';
import { useChrome } from '@/lib/chrome-i18n';
import { appUrl } from '@/lib/appBase';

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
  const signatureId = useThemeStore((s) => s.signature);
  // One precedence for every frontend (the kit's BrandMark): the signature's
  // wordmark when the tenant set neither a logo nor a name; otherwise the tenant's
  // logo, else the signature's monogram, else the initial — each with the name.
  const brand = (fill: boolean) => (
    <BrandMark
      name={appName}
      logoUrl={branding?.logo ? appUrl(branding.logo) : undefined}
      nameIsCustom={Boolean(branding?.app_name)}
      signature={getSignature(signatureId)}
      fill={fill}
    />
  );

  // Top/bottom bar: compact, inline, no border (the bar owns its border).
  if (side === 'top' || side === 'bottom') {
    return (
      <div className="flex shrink-0 items-center gap-2 px-2">{brand(false)}</div>
    );
  }

  // Left/right rail: an h-14 header row matching the topbar height.
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      {collapsed ? (
        <button
          type="button"
          className={cn(railButtonClass, 'mx-auto p-1.5')}
          onClick={onToggleCollapse}
          aria-label={tc('ui.nav.expand')}
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      ) : (
        <>
          {brand(true)}
          {onClose && (
            <button
              type="button"
              className={cn(railButtonClass, 'lg:hidden')}
              onClick={onClose}
              aria-label={tc('ui.nav.close')}
            >
              <X className="h-5 w-5" />
            </button>
          )}
          {collapsible && onToggleCollapse && (
            <button
              type="button"
              className={cn(railButtonClass, 'hidden lg:inline-flex')}
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
