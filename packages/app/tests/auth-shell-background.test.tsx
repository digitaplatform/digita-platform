// @vitest-environment jsdom
// The app's sign-in page draws the tenant's background only from the app's own paths or inline, as
// one image: no stored value makes every visitor's page request another host.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useSessionStore } from '@/stores/session';
import { AuthShell } from '@/templates/AuthShell';

vi.mock('@/components/layout/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));

function shellWith(login_background: string) {
  useSessionStore.setState({ branding: { login_background } as never });
  return render(<AuthShell>form</AuthShell>);
}

afterEach(() => {
  cleanup();
  useSessionStore.setState({ branding: null });
});

describe("the sign-in page's background", () => {
  it("draws a path of the app's own and an inline image as one image", () => {
    const path = shellWith('/api/v1/public/file/FILE-1');
    expect(path.getByTestId('auth-background').getAttribute('src')).toBe('/api/v1/public/file/FILE-1');
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
});
