// @vitest-environment jsdom
// useTreePath reads a tree node's path from the target's list one level at a time: each request
// names every id found so far, and the topmost row's parent field names the next one.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TreeConfig } from '@digitaplatform/shared';

type ListParams = { filters?: [string, string, unknown][]; page_size?: number };
const engine = vi.hoisted(() => ({
  rows: [
    { _id: 'G-1', name: 'Business customers', parent: null },
    { _id: 'G-2', name: 'Hotels', parent: 'G-1' },
    { _id: 'G-5', name: 'Spa hotels', parent: 'G-2' },
  ] as Array<Record<string, unknown>>,
  requests: [] as ListParams[],
}));
vi.mock('@/services/resource', () => ({
  // Answers as the engine does: only the rows whose _id an `in` filter names.
  getList: async (_entity: string, params: ListParams) => {
    engine.requests.push(params);
    const ids = params.filters?.find(([field, op]) => field === '_id' && op === 'in')?.[2] as string[];
    const rows = engine.rows.filter((r) => ids.includes(r._id as string));
    return { data: rows, meta: { total: rows.length, page: 1, page_size: params.page_size, total_pages: 1 } };
  },
}));

import { useTreePath } from '@/hooks/useTreePath';

const TREE: TreeConfig = { parent_field: 'parent', label_field: 'name' } as TreeConfig;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  engine.requests.length = 0;
});

describe('useTreePath', () => {
  it('returns the labels from the root to the node', async () => {
    const { result } = renderHook(() => useTreePath('CustomerGroup', TREE, 'name', 'G-5'), { wrapper });
    await waitFor(() => expect(result.current.labels).toEqual(['Business customers', 'Hotels', 'Spa hotels']));
    expect(result.current.error).toBeNull();
  });

  it('asks for every id found so far, one level more each time', async () => {
    const { result } = renderHook(() => useTreePath('CustomerGroup', TREE, 'name', 'G-5'), { wrapper });
    await waitFor(() => expect(result.current.labels).toBeDefined());
    const askedIds = engine.requests.map((r) => r.filters?.[0]?.[2]);
    expect(askedIds).toEqual([['G-5'], ['G-5', 'G-2'], ['G-5', 'G-2', 'G-1']]);
  });
});
