import { describe, expect, it } from 'vitest';
import { resolveDeepLinkTokens } from '@/lib/deep-link-tokens';

describe("a dashboard deep link's tokens", () => {
  // At 00:30 in Zurich on 2026-09-30, UTC is still on the 29th.
  const halfPastMidnightInZurich = new Date('2026-09-29T22:30:00Z');

  it("fills $now with the tenant's day", () => {
    expect(resolveDeepLinkTokens('/WorkOrder?due=$now', null, 'Europe/Zurich', halfPastMidnightInZurich)).toBe('/WorkOrder?due=2026-09-30');
    expect(resolveDeepLinkTokens('/WorkOrder?due=$now', null, 'UTC', halfPastMidnightInZurich)).toBe('/WorkOrder?due=2026-09-29');
  });

  it('fills $user keys and drops a link with a token it cannot fill', () => {
    expect(resolveDeepLinkTokens('/WorkOrder?assignee=$user.email', { email: 'mia@shop.example' }, 'UTC')).toBe('/WorkOrder?assignee=mia@shop.example');
    expect(resolveDeepLinkTokens('/WorkOrder?x=$unknown', null, 'UTC')).toBeNull();
  });
});
