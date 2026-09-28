import { useSyncExternalStore } from "react";

/**
 * Whether the contact sheet is open. A block's call to action opens it; the site chrome renders
 * the sheet and closes it. A module-level store, because the button and the sheet live in
 * different trees of the page and share no parent state.
 */
let isOpen = false;
const listeners = new Set<() => void>();

function setOpen(open: boolean): void {
  if (isOpen === open) return;
  isOpen = open;
  for (const listener of listeners) listener();
}

export function openContactSheet(): void {
  setOpen(true);
}

export function closeContactSheet(): void {
  setOpen(false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller when the sheet opens or closes. The server always renders it closed. */
export function useContactSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => isOpen, () => false);
}
