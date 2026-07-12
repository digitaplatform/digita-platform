import { provideHostServices } from '@digitaplatform/plugins';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useUiStore } from '@/stores/ui';

/**
 * Wire the host's runtime capabilities into the plugin SDK once at boot, so
 * plugins consume them via useHost() without importing any host internals.
 */
export function installHostServices(): void {
  provideHostServices({
    api,
    getUser: () => useSessionStore.getState().user,
    t: (key, params) => useI18nStore.getState().t(key, params),
    closeMobileNav: () => useUiStore.getState().setMobileNav(false),
  });
}
