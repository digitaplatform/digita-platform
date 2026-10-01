import { provideHostServices } from '@digitaplatform/plugins';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useUiStore } from '@/stores/ui';
import { chromeT } from '@/lib/chrome-i18n';

/**
 * Wire the host's runtime capabilities into the plugin SDK once at boot, so
 * plugins consume them via useHost() without importing any host internals.
 */
export function installHostServices(): void {
  provideHostServices({
    api,
    getUser: () => useSessionStore.getState().user,
    // ui.* keys are the app's chrome texts, which the pod serves as files; the i18n store holds
    // only the engine's data texts and would answer them with the bare key.
    t: (key, params) => (key.startsWith('ui.') ? chromeT(key, params) : useI18nStore.getState().t(key, params)),
    closeMobileNav: () => useUiStore.getState().setMobileNav(false),
  });
}
