import { create } from 'zustand';

/**
 * The record-title seam: RecordPage publishes its resolved title; Breadcrumbs reads
 * it ON AN EXACT (entity, name) match (any mismatch → "not yet loaded" → the raw
 * :name). RecordPage clear()s before the next route publishes (avoids a stale leaf).
 */
interface RecordTitleState {
  entity: string | null;
  name: string | null;
  title: string | null;
  publish: (entity: string, name: string, title: string) => void;
  clear: () => void;
}

export const useRecordTitle = create<RecordTitleState>((set) => ({
  entity: null,
  name: null,
  title: null,
  publish: (entity, name, title) => set({ entity, name, title }),
  clear: () => set({ entity: null, name: null, title: null }),
}));
