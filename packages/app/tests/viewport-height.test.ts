// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useViewportHeight } from '@/hooks/useViewportHeight';

describe('useViewportHeight', () => {
  it('follows the viewport across a resize', () => {
    window.innerHeight = 800;
    const { result } = renderHook(() => useViewportHeight());
    expect(result.current).toBe(800);
    act(() => {
      window.innerHeight = 500;
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(500);
  });
});
