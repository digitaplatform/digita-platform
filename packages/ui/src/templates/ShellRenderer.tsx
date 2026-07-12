import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CommandPalette } from '@/components/command/CommandPalette';
import { useHotkey } from '@/lib/use-hotkey';
import type { LayoutConfig, RegionDefinition, RegionSide, TemplateDefinition } from '@digitaplatform/plugins';
import { useUiStore } from '@/stores/ui';
import { Topbar } from '@/components/layout/Topbar';
import { BrandChrome } from '@/components/layout/BrandChrome';
import { Region } from '@/plugins/registry';
import { useChrome } from '@/lib/chrome-i18n';
import { tid } from '@/lib/testid';
import { usePluginLayoutStore } from '@/stores/plugin-state';
import { resolveTemplate } from '@/templates/template-registry';
import { useRealtimeConnection } from '@/hooks/useRealtime';
import { cn } from '@digitaplatform/components';

/**
 * A region is painted only if it's the main outlet, has a placed plugin, or
 * shows brand chrome — an empty plugin-region takes zero space (no blank rails).
 */
function isFilled(layout: LayoutConfig, region: RegionDefinition): boolean {
  return region.side === 'main' || Boolean(layout.regions[region.id]) || Boolean(region.brand);
}

function bySide(def: TemplateDefinition, side: RegionSide): RegionDefinition[] {
  return def.regions.filter((r) => r.side === side).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Sub-components are module-level (stable identity) so the host never remounts a
// placed plugin — and its state/fetches — on an unrelated shell re-render.

/** The shared frame for a left/right rail: brand chrome (if any) + placed plugin. */
function Rail({ region, side, inDrawer }: { region: RegionDefinition; side: 'left' | 'right'; inDrawer?: boolean }) {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setMobileNav = useUiStore((s) => s.setMobileNav);
  const collapsible = Boolean(region.collapsible) && !inDrawer;
  const collapsed = sidebarCollapsed && collapsible;
  const width = collapsed ? (region.size?.mobile ?? 'w-16') : (region.size?.desktop ?? 'w-72');

  return (
    <div className={cn('flex h-full flex-col bg-surface border-border', width, side === 'left' ? 'border-r' : 'border-l')}>
      {region.brand && (
        <BrandChrome
          side={side}
          collapsed={collapsed}
          collapsible={collapsible}
          onToggleCollapse={toggleSidebar}
          onClose={inDrawer ? () => setMobileNav(false) : undefined}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Region name={region.id} />
      </div>
    </div>
  );
}

/** Desktop wrapper that hides drawer/hidden-mode rails below `lg`. */
function DockedRail({ region, side }: { region: RegionDefinition; side: 'left' | 'right' }) {
  const mode = region.mobile ?? 'drawer';
  const responsive = mode === 'drawer' || mode === 'hidden' ? 'hidden lg:flex' : 'flex';
  return (
    <aside aria-label={region.label} {...tid.region(region.id)} className={cn('h-full shrink-0', responsive)}>
      <Rail region={region} side={side} />
    </aside>
  );
}

/** A top/bottom horizontal bar region. */
function Bar({ region }: { region: RegionDefinition }) {
  const mode = region.mobile ?? 'static';
  const height = region.size?.desktop ?? 'h-14';
  const isTop = region.side === 'top';
  return (
    <div
      role={region.label ? 'region' : undefined}
      aria-label={region.label}
      className={cn(
        'flex shrink-0 items-center gap-3 bg-surface border-border px-2',
        height,
        isTop ? 'border-b' : 'border-t',
        mode === 'hidden' && 'hidden lg:flex',
      )}
    >
      {region.brand && <BrandChrome side={region.side} />}
      <div className="min-w-0 flex-1">
        <Region name={region.id} />
      </div>
    </div>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * One mobile overlay drawer, driven by the single mobileNavOpen flag. Targets
 * the first drawer-mode rail (left before right) — multi-drawer is deferred.
 * It is a proper modal dialog: labelled, Escape-to-close, focus moved in on
 * open, focus trapped within, and restored to the opener on close.
 */
function MobileDrawer({ rail }: { rail: RegionDefinition | undefined }) {
  const tc = useChrome();
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNav = useUiStore((s) => s.setMobileNav);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileNavOpen || !rail) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => (panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);
    (focusables()[0] ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileNav(false);
        return;
      }
      if (e.key === 'Tab' && panel) {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          e.preventDefault();
          panel.focus();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [mobileNavOpen, rail, setMobileNav]);

  if (!mobileNavOpen || !rail) return null;
  const side: 'left' | 'right' = rail.side === 'right' ? 'right' : 'left';
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMobileNav(false)} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={rail.label ?? tc('ui.nav.label')}
        tabIndex={-1}
        className={cn('absolute inset-y-0 shadow-md focus:outline-none focus-visible:shadow-focus', side === 'right' ? 'right-0' : 'left-0')}
      >
        <Rail region={rail} side={side} inDrawer />
      </div>
    </div>
  );
}

/**
 * The ONE generic, config-driven shell. It paints whatever the active
 * TemplateDefinition declares for APP regions — adding a template is pure
 * config, no new code. The host's own utility bar (Topbar: theme/user/sign-out)
 * is universal host chrome present in every template; TemplateDefinition controls
 * placement of app plugins + brand chrome AROUND it. Knows NO plugin by name
 * (placement lives in LayoutConfig.regions) and NO template by name (resolved
 * from the registry by id). Mounted by App.tsx as the layout route element.
 */
export function ShellRenderer() {
  // Reactive: re-renders when the plugin composition (re)loads — e.g. after login.
  const layout = usePluginLayoutStore((s) => s.layout);
  const def = resolveTemplate(layout.template);
  const tc = useChrome();

  // One live-sync socket for the whole authenticated session (no-op when the
  // engine has realtime off); views declare their entity via useRealtimeEntity.
  useRealtimeConnection();

  // Stable setter subscription only — never re-renders the shell on nav toggles,
  // so desktop rail plugins keep their identity/state.
  const setMobileNav = useUiStore((s) => s.setMobileNav);
  const setCommandPalette = useUiStore((s) => s.setCommandPalette);
  // Cmd/Ctrl-K opens the command palette (host reacts to the ui-store flag).
  useHotkey({ key: 'k', meta: true }, () => setCommandPalette(true));
  const { pathname } = useLocation();
  // Host-owned safety net: dismiss the mobile drawer on any navigation, even if
  // a placed plugin forgets to call closeMobileNav().
  useEffect(() => {
    setMobileNav(false);
  }, [pathname, setMobileNav]);

  const top = bySide(def, 'top').filter((r) => isFilled(layout, r));
  const left = bySide(def, 'left').filter((r) => isFilled(layout, r));
  const right = bySide(def, 'right').filter((r) => isFilled(layout, r));
  const bottom = bySide(def, 'bottom').filter((r) => isFilled(layout, r));
  const drawerRail = [...left, ...right].find((r) => (r.mobile ?? 'drawer') === 'drawer');

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background" {...tid.component('app-shell')}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary-600 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        {tc('ui.nav.skipToContent')}
      </a>
      {top.map((r) => (
        <Bar key={r.id} region={r} />
      ))}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {left.map((r) => (
          <DockedRail key={r.id} region={r} side="left" />
        ))}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main id="main-content" tabIndex={-1} {...tid.region('main')} className="flex-1 overflow-y-auto">
            {/* Topbar lives INSIDE the scroll container (sticky) so content scrolls
                UNDER it — required for the iOS translucent-blur bar. Opaque bg-surface
                for every other design, so visually unchanged. */}
            <Topbar showMenuButton={Boolean(drawerRail)} />
            {/* Fluid content: grows with the viewport; p-* provides the top/left/right margins. */}
            <div className="w-full p-4 md:p-8">
              <Outlet />
            </div>
          </main>
        </div>

        {right.map((r) => (
          <DockedRail key={r.id} region={r} side="right" />
        ))}
      </div>

      {bottom.map((r) => (
        <Bar key={r.id} region={r} />
      ))}

      <MobileDrawer rail={drawerRail} />
      <CommandPalette />
    </div>
  );
}
