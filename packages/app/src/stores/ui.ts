import { create } from 'zustand';

/** Transient UI chrome state. Never server-derived; never rendered by Units. */
interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setCommandPalette: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  commandPaletteOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  setCommandPalette: (open) => set({ commandPaletteOpen: open }),
}));
