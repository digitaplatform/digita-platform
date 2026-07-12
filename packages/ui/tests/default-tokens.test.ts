import { describe, it, expect } from 'vitest';
import { resolveDefaultToken } from '@/lib/default-tokens';

describe('resolveDefaultToken (H-P5 UI — child-row magic defaults)', () => {
  it('expands date/time tokens to concrete values', () => {
    expect(resolveDefaultToken('__today__')).toBe(new Date().toISOString().slice(0, 10));
    const now = resolveDefaultToken('__now__');
    expect(typeof now).toBe('string');
    expect(now as string).toContain('T'); // ISO datetime, not the literal token
  });

  it('expands user tokens from the session user', () => {
    expect(resolveDefaultToken('__user__', { email: 'a@b.c' })).toBe('a@b.c');
    expect(resolveDefaultToken('__username__', { email: 'a@b.c', full_name: 'Ann' })).toBe('Ann');
    expect(resolveDefaultToken('__username__', { email: 'a@b.c' })).toBe('a@b.c'); // falls back
    expect(resolveDefaultToken('__user__', null)).toBe(''); // no user
  });

  it('passes through non-token strings and non-strings unchanged', () => {
    expect(resolveDefaultToken('literal-value')).toBe('literal-value');
    expect(resolveDefaultToken(42)).toBe(42);
    expect(resolveDefaultToken(true)).toBe(true);
  });
});
