// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A saved record's edit previews through POST <Entity>/<name>/preview; a draft through
// POST <Entity>/preview. The hook hands the name on, and the service builds the path from it.
const post = vi.hoisted(() => vi.fn<(path: string, body?: unknown) => Promise<unknown>>(async () => ({ success: true, data: {} })));
vi.mock('@/services/api', () => ({ api: { post } }));

import { previewDoc } from '@/services/resource';
import { usePreview } from '@/hooks/usePreview';

beforeEach(() => post.mockClear());
afterEach(() => vi.useRealTimers());

describe('the preview path', () => {
  it('names the saved record in the path, and none for a draft', async () => {
    await previewDoc('Order', { title: 'x' }, 'SO 1');
    await previewDoc('Order', { title: 'x' });
    expect(post.mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/\/Order\/SO%201\/preview$/),
      expect.stringMatching(/\/Order\/preview$/),
    ]);
  });

  it('hands the name of the hook on to the request', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePreview('Order', { name: 'SO-1', debounceMs: 10 }));
    act(() => result.current.trigger({ title: 'x' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toMatch(/\/Order\/SO-1\/preview$/);
  });
});
