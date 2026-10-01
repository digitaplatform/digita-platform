// @vitest-environment jsdom
// Plugins learn the report designer's address from the host, so a menu entry can open it on any
// tenant: under the tenant's path (/report) or on its own subdomain (report.<zone>). The address
// is the app's REPORT_URL, which env.js writes per tenant and environment.
import { afterEach, describe, expect, it, vi } from 'vitest';

async function installWith(reportUrl: string) {
  vi.resetModules();
  (window as unknown as Record<string, unknown>).__REPORT_URL__ = reportUrl;
  const { installHostServices } = await import('@/plugins/host-services');
  const { useHost } = await import('@digitaplatform/plugins');
  installHostServices();
  return useHost();
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__REPORT_URL__;
});

describe('the host services', () => {
  it.each([
    ['a tenant routed by path', 'https://show.digitaplatform.com/report/', 'https://show.digitaplatform.com/report'],
    ['a tenant routed by subdomain', 'https://report.acme.digitacloud.app', 'https://report.acme.digitacloud.app'],
  ])('hand plugins the report designer address of %s', async (_case, reportUrl, designerUrl) => {
    expect((await installWith(reportUrl)).reportDesignerUrl).toBe(designerUrl);
  });
});
