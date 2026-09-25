import { Menu, Moon, Sun, Monitor, Search } from 'lucide-react';
import { ModeButton, TopBar, topBarButtonClass, cn } from '@digitaplatform/components';
import { useThemeStore } from '@/stores/theme';
import { useUiStore } from '@/stores/ui';
import { useChrome } from '@/lib/chrome-i18n';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { AppMenu } from '@/components/layout/AppMenu';
import { DensityMenu } from '@/components/layout/DensityMenu';
import { DesignMenu } from '@/components/layout/DesignMenu';
import { SignatureMenu } from '@/components/layout/SignatureMenu';

/**
 * Universal host chrome: breadcrumbs, the command-palette search trigger, language,
 * density + theme toggles, and the app/account menu (which owns sign-out).
 * `showMenuButton` is set by the shell only when the active template has a drawer.
 */
export function Topbar({ showMenuButton = true }: { showMenuButton?: boolean }) {
  const mode = useThemeStore((s) => s.mode);
  const cycleMode = useThemeStore((s) => s.cycleMode);
  const setMobileNav = useUiStore((s) => s.setMobileNav);
  const setCommandPalette = useUiStore((s) => s.setCommandPalette);
  const tc = useChrome();

  return (
    <TopBar>
      <div className="flex min-w-0 items-center gap-2">
        {showMenuButton ? (
          <button
            type="button"
            className={cn(topBarButtonClass, 'lg:hidden')}
            onClick={() => setMobileNav(true)}
            aria-label={tc('ui.nav.open')}
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : null}
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(topBarButtonClass, 'flex items-center gap-2')}
          onClick={() => setCommandPalette(true)}
          aria-label={tc('ui.cmd.title')}
        >
          <Search className="h-5 w-5" />
          <span className="hidden text-xs lg:inline">{tc('ui.list.search')} ⌘K</span>
        </button>
        <LanguageSwitcher />
        <DesignMenu />
        <SignatureMenu />
        <DensityMenu />
        <ModeButton
          mode={mode}
          onCycle={cycleMode}
          label={tc('ui.theme.toggle')}
          icons={{ light: <Sun className="h-5 w-5" />, dark: <Moon className="h-5 w-5" />, system: <Monitor className="h-5 w-5" /> }}
        />
        <AppMenu />
      </div>
    </TopBar>
  );
}
