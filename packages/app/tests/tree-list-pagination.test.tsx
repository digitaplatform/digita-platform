// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useList } from '@/hooks/useList';

const getList = vi.hoisted(() => vi.fn());
vi.mock('@/services/resource', () => ({ getList }));
beforeEach(() => { getList.mockReset(); });

describe('a complete tree list', () => {
  it('includes later-page kinds and parents before offering the forest', async () => {
    const first = Array.from({ length: 2000 }, (_, i) => ({
      _id: `N${String(i).padStart(4, '0')}`, kind: i < 1000 ? 'customers' : 'parts', parent: null,
    }));
    getList.mockImplementation(async (_entity, params) => ({
      data: params.page === 1 ? first : [{ _id: 'Z-parent', kind: 'suppliers', parent: null }],
      meta: { total: 2001, page: params.page, page_size: 2000, total_pages: 2 },
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useList('Group', { page_size: 2000 }, { allPages: true }), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows).toHaveLength(2001);
    expect(new Set(result.current.data?.rows.map((row) => row.kind))).toEqual(new Set(['customers', 'parts', 'suppliers']));
    expect(getList.mock.calls.map(([, params]) => [params.page, params.order_by])).toEqual([[1, '_id asc'], [2, '_id asc']]);
    client.clear();
  });

  it('reports a later-page failure instead of treating a partial tree as complete', async () => {
    getList.mockImplementation(async (_entity, params) => {
      if (params.page === 2) throw new Error('Second page failed');
      return { data: [{ _id: 'child', parent: 'later-page-parent' }], meta: { total: 2, page: 1, page_size: 1, total_pages: 2 } };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useList('Group', { page_size: 2000 }, { allPages: true }), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    client.clear();
  });
});
