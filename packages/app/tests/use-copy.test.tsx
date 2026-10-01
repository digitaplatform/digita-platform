// @vitest-environment jsdom
// The engine copies a saved record into a new draft at POST .../copy and answers that draft,
// with its own _id. useCopy seeds the draft under its id and leaves the source doc's cache
// as it is.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCopy } from '@/hooks/useDocument';
import { qk } from '@/lib/query-keys';

afterEach(() => vi.unstubAllGlobals());

function setup(answer: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(String(url), window.location.origin).pathname}`);
    return answer();
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const source = { _id: 'INV 1', docstatus: 1, note: 'a' };
  qc.setQueryData(qk.doc('Invoice', 'INV 1'), source);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useCopy('Invoice'), { wrapper });
  return { calls, qc, source, result };
}

describe('useCopy', () => {
  it('posts to the copy route and seeds the draft it answers under the draft id', async () => {
    const draft = { _id: 'INV-2', docstatus: 0, note: 'a' };
    const { calls, qc, source, result } = setup(
      () => new Response(JSON.stringify({ success: true, messages: [], data: draft }), { status: 201 }),
    );
    let copied: unknown;
    await act(async () => {
      copied = await result.current.mutateAsync('INV 1');
    });
    expect(copied).toEqual(draft);
    expect(calls).toEqual(['POST /api/v1/resource/Invoice/INV%201/copy']);
    expect(qc.getQueryData(qk.doc('Invoice', 'INV-2'))).toEqual(draft);
    expect(qc.getQueryData(qk.doc('Invoice', 'INV 1'))).toEqual(source);
  });

  it('rejects with the engine error and seeds nothing when the copy is refused', async () => {
    const { qc, result } = setup(
      () =>
        new Response(
          JSON.stringify({ success: false, messages: [{ type: 'error', text: 'No create permission' }], error: { code: 'PERMISSION_DENIED' } }),
          { status: 403 },
        ),
    );
    await act(async () => {
      await expect(result.current.mutateAsync('INV 1')).rejects.toThrow('No create permission');
    });
    expect(qc.getQueryCache().findAll({ queryKey: qk.doc('Invoice', 'INV-2') })).toHaveLength(0);
  });
});
