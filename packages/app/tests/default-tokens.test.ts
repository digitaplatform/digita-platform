import { afterEach, describe, it, expect, vi } from 'vitest';
import { resolveDefaultToken } from '@/lib/default-tokens';

describe('resolveDefaultToken (H-P5 UI — child-row magic defaults)', () => {
  it('expands date/time tokens to concrete values', () => {
    expect(resolveDefaultToken('__today__', null, 'UTC')).toBe(new Date().toISOString().slice(0, 10));
    const now = resolveDefaultToken('__now__', null, 'UTC');
    expect(typeof now).toBe('string');
    expect(now as string).toContain('T'); // ISO datetime, not the literal token
  });

  it('expands user tokens from the session user', () => {
    expect(resolveDefaultToken('__user__', { email: 'a@b.c' }, 'UTC')).toBe('a@b.c');
    expect(resolveDefaultToken('__username__', { email: 'a@b.c', full_name: 'Ann' }, 'UTC')).toBe('Ann');
    expect(resolveDefaultToken('__username__', { email: 'a@b.c' }, 'UTC')).toBe('a@b.c'); // falls back
    expect(resolveDefaultToken('__user__', null, 'UTC')).toBe(''); // no user
  });

  it('passes through non-token strings and non-strings unchanged', () => {
    expect(resolveDefaultToken('literal-value', null, 'UTC')).toBe('literal-value');
    expect(resolveDefaultToken(42, null, 'UTC')).toBe(42);
    expect(resolveDefaultToken(true, null, 'UTC')).toBe(true);
  });
});

describe("__today__ in the form", () => {
  afterEach(() => vi.useRealTimers());

  it("is the tenant's day: at 00:30 in Zurich, UTC is still on the day before", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T22:30:00Z'));
    expect(resolveDefaultToken('__today__', null, 'Europe/Zurich')).toBe('2026-09-30');
    expect(resolveDefaultToken('__today__', null, 'UTC')).toBe('2026-09-29');
  });
});
