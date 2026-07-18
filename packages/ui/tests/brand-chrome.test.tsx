// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BrandChrome } from '@/components/layout/BrandChrome';
import { useThemeStore } from '@/stores/theme';
import { useSessionStore } from '@/stores/session';
import type { BootBranding } from '@/types';

afterEach(() => {
  cleanup();
  useThemeStore.setState({ signature: 'digita' });
  useSessionStore.setState({ branding: null });
});

describe('BrandChrome — signature wordmark', () => {
  it('renders the digita wordmark lockup in an EXPANDED rail (no tenant branding)', () => {
    useThemeStore.setState({ signature: 'digita' });
    useSessionStore.setState({ branding: null });
    render(<BrandChrome side="left" />);
    const mark = screen.getByTestId('brand-wordmark');
    // The lockup carries its own accessible name (the inner SVG is aria-hidden).
    expect(mark).toHaveAttribute('role', 'img');
    expect(mark).toHaveAttribute('aria-label', 'Digita');
  });

  it('falls back to the monogram (no wordmark) in a COLLAPSED rail', () => {
    useThemeStore.setState({ signature: 'digita' });
    render(<BrandChrome side="left" collapsed collapsible />);
    expect(screen.queryByTestId('brand-wordmark')).toBeNull();
  });

  it('does NOT use the wordmark when the tenant set an app name — renders it as text', () => {
    useThemeStore.setState({ signature: 'digita' });
    useSessionStore.setState({ branding: { app_name: 'Acme' } as BootBranding });
    render(<BrandChrome side="top" />);
    expect(screen.queryByTestId('brand-wordmark')).toBeNull();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('a thin signature (simetrix) shows the monogram, never a wordmark', () => {
    useThemeStore.setState({ signature: 'simetrix' });
    useSessionStore.setState({ branding: null });
    render(<BrandChrome side="top" />);
    expect(screen.queryByTestId('brand-wordmark')).toBeNull();
  });
});
