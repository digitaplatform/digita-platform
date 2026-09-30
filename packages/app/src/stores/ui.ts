import { create } from 'zustand';

/** Transient UI chrome state. Never server-derived; never rendered by Units. */
interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  /** The open groups of each tree picker's target entity, so its next open shows them as a
   *  person left them while the app is open. */
  treePickerExpandedIds: Record<string, Set<string>>;
  /** The nodes a person closed in each entity's tree editor while the app is open. Every other
   *  node shows open, also one that arrives later. */
  treeEditorCollapsedIds: Record<string, Set<string>>;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setCommandPalette: (open: boolean) => void;
  setTreePickerExpandedIds: (entity: string, ids: Set<string>) => void;
  setTreeEditorCollapsedIds: (entity: string, ids: Set<string>) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  commandPaletteOpen: false,
  treePickerExpandedIds: {},
  treeEditorCollapsedIds: {},
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  setCommandPalette: (open) => set({ commandPaletteOpen: open }),
  setTreePickerExpandedIds: (entity, ids) =>
    set((s) => ({ treePickerExpandedIds: { ...s.treePickerExpandedIds, [entity]: ids } })),
  setTreeEditorCollapsedIds: (entity, ids) =>
    set((s) => ({ treeEditorCollapsedIds: { ...s.treeEditorCollapsedIds, [entity]: ids } })),
}));
