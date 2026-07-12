// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SESSION_COOKIE } from '@digitaplatform/shared';

describe('attemptRefresh', () => {
  beforeEach(() => {
    // a readable CSRF cookie so attemptRefresh does not short-circuit
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: `${SESSION_COOKIE.CSRF}=csrf-123`,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('POSTs /auth/refresh with a non-empty JSON body (not an empty body under json content-type)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { attemptRefresh } = await import('../src/services/api.ts');
    const ok = await attemptRefresh();
    expect(ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.body, 'refresh must send a body so the json body-parser does not 400').toBeDefined();
    expect(String(init.body).length).toBeGreaterThan(0);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
