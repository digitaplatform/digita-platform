// @vitest-environment jsdom
// The app's sign-in page draws the tenant's background only from the app's own paths or inline, as
// one image: no stored value makes every visitor's page request another host.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// The app stands under a base path, as a tenant routed by path serves it: a path of the app's own
// gets it in front, or the background is asked of another app.
vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '/erp';
});
const { useSessionStore } = await import('@/stores/session');
const { useThemeStore } = await import('@/stores/theme');
const { getSignature } = await import('@digitaplatform/theme');
const { AuthShell } = await import('@/templates/AuthShell');

vi.mock('@/components/layout/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));

function shellWith(login_background: string) {
  useSessionStore.setState({ branding: { login_background } as never });
  return render(<AuthShell>form</AuthShell>);
}

afterEach(() => {
  cleanup();
  useSessionStore.setState({ branding: null, settings: null });
});

describe("the sign-in page's background", () => {
  it("draws a path of the app's own and an inline image as one image", () => {
    const path = shellWith('/api/v1/public/file/FILE-1');
    expect(path.getByTestId('auth-background').getAttribute('src')).toBe('/erp/api/v1/public/file/FILE-1');
    cleanup();
    const inline = shellWith('data:image/png;base64,iVBORw0KGgo=');
    expect(inline.getByTestId('auth-background').getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('PLANTED DEFECT: draws nothing for a value that ends a CSS url() and adds another, or names another host', () => {
    for (const value of ['/x"),url("https://evil.example/t.png', '/x)url(https://evil.example/t.png', 'https://evil.example/bg.jpg']) {
      const view = shellWith(value);
      expect(view.queryByTestId('auth-background'), value).toBeNull();
      expect(view.container.innerHTML, value).not.toContain('evil.example');
      cleanup();
    }
  });

  it("PLANTED DEFECT: draws the app's own logos under its base path, and no logo from another host", () => {
    useSessionStore.setState({ branding: { logo: '/api/v1/public/file/LOGO', logo_dark: '/api/v1/public/file/DARK' } as never });
    const own = render(<AuthShell>form</AuthShell>);
    expect(own.container.querySelectorAll('img[src="/erp/api/v1/public/file/LOGO"], img[src="/erp/api/v1/public/file/DARK"]').length).toBeGreaterThan(0);
    cleanup();
    useSessionStore.setState({ branding: { logo: 'https://evil.example/logo.png', logo_dark: '//evil.example/dark.png' } as never });
    const outside = render(<AuthShell>form</AuthShell>);
    expect(outside.container.innerHTML).not.toContain('evil.example');
  });

  it("PLANTED DEFECT: names the look the tenant wears on its sign-in when it set no app_name", () => {
    useThemeStore.setState({ signature: 'simetrix' });
    useSessionStore.setState({ branding: {} as never });
    const { container } = render(<AuthShell>form</AuthShell>);
    expect(getSignature('simetrix').name).not.toBe('Digita');
    expect(container.innerHTML).toContain(getSignature('simetrix').name);
    expect(container.innerHTML).not.toContain('Digita');
  });

  it('PLANTED DEFECT: names the tenant on its sign-in by its app_name', () => {
    useSessionStore.setState({ branding: { app_name: 'Velo Luck GmbH' } as never });
    expect(render(<AuthShell>form</AuthShell>).container.textContent).toContain('Velo Luck GmbH');
  });
});
