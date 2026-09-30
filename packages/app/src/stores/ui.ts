import { create } from 'zustand';

/** Transient UI chrome state. Never server-derived; never rendered by Units. */
interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  /** The open groups of each tree entity, shared by its pickers and its tree editor,
   *  so the next open shows them as a person left them while the app is open. */
  treeExpandedIds: Record<string, Set<string>>;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setCommandPalette: (open: boolean) => void;
  setTreeExpandedIds: (entity: string, ids: Set<string>) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  commandPaletteOpen: false,
  treeExpandedIds: {},
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  setCommandPalette: (open) => set({ commandPaletteOpen: open }),
  setTreeExpandedIds: (entity, ids) => set((s) => ({ treeExpandedIds: { ...s.treeExpandedIds, [entity]: ids } })),
}));
