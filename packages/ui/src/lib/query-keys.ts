/**
 * Central TanStack Query key factory. One place so invalidation stays correct
 * across mutations (e.g. submit invalidates both the doc and its lists).
 */
export const qk = {
  boot: () => ['boot'] as const,
  translations: (locale: string) => ['translations', locale] as const,
  metaCatalog: () => ['meta'] as const,
  meta: (entity: string) => ['meta', entity] as const,
  list: (entity: string, params: unknown) => ['resource', entity, 'list', params] as const,
  doc: (entity: string, name: string) => ['resource', entity, 'doc', name] as const,
  single: (entity: string) => ['resource', entity, 'single'] as const,
  actions: (entity: string, name: string) => ['resource', entity, 'doc', name, 'actions'] as const,
  search: (entity: string, q: string, filters?: unknown) =>
    ['search', entity, q, filters ?? null] as const,
  globalSearch: (q: string) => ['search', 'global', q] as const,
  view: (name: string, params?: unknown) => ['view', name, params ?? null] as const,
  workspace: (id: string) => ['workspace', id] as const,
  listPreferences: (entity: string) => ['listPreferences', entity] as const,
  sessions: () => ['account', 'sessions'] as const,
};

/** Invalidation prefixes (kept here so mutations + hooks agree on the shapes). */
export const qkPrefix = {
  entity: (entity: string) => ['resource', entity] as const,
  lists: (entity: string) => ['resource', entity, 'list'] as const,
  allMeta: () => ['meta'] as const,
  listPreferences: (entity: string) => ['listPreferences', entity] as const,
};
