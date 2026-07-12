import { create } from 'zustand';
import type { LayoutConfig } from '@digitaplatform/plugins';

/**
 * The active plugin placement (template + region→plugin map). Reactive so the
 * shell re-renders when the composition is (re)loaded — notably after an in-app
 * login, where the anonymous boot had no user yet and loaded no plugins. With a
 * plain module variable the shell mounted (on the auth transition) before the
 * post-login load ran, leaving the nav region empty until a full reload (F5).
 */
interface PluginLayoutState {
  layout: LayoutConfig;
  setLayout: (layout: LayoutConfig) => void;
}

export const usePluginLayoutStore = create<PluginLayoutState>((set) => ({
  layout: { template: 'classic', regions: {} },
  setLayout: (layout) => set({ layout }),
}));
