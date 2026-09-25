// @vitest-environment jsdom
// The chrome parts the app's shell and the website's header both render: one brand precedence,
// one mode cycle, one language menu, one mobile drawer, and a link that is styled and marked like the
// kit's button.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BaseDialog, BrandMark, Card, Drawer, LanguageMenu, ModeButton, TopBar, buttonAttributes, nextMode } from '../src/index.js';

afterEach(cleanup);

const signature = { monogram: '<svg data-m="1"></svg>', wordmark: '<svg data-w="1"></svg>' };

describe('BrandMark', () => {
  it('shows the signature wordmark when the tenant set neither a logo nor a name', () => {
    render(<BrandMark name="Digita" signature={signature} />);
    expect(screen.getByTestId('brand-wordmark')).toHaveAttribute('aria-label', 'Digita');
  });

  it('shows the monogram and the name when the tenant named itself', () => {
    const { container } = render(<BrandMark name="Acme" nameIsCustom signature={signature} />);
    expect(screen.queryByTestId('brand-wordmark')).toBeNull();
    expect(container.querySelector('[data-m]')).not.toBeNull();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('lets the tenant logo win, and falls back to the initial without a monogram', () => {
    const { container, rerender } = render(<BrandMark name="Acme" logoUrl="/logo.png" signature={signature} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/logo.png');
    rerender(<BrandMark name="acme" nameIsCustom />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});

describe('ModeButton', () => {
  it('cycles light → dark → system → light', () => {
    expect([nextMode('light'), nextMode('dark'), nextMode('system')]).toEqual(['dark', 'system', 'light']);
  });

  it('shows the active mode icon and asks for the next mode', () => {
    const onCycle = vi.fn();
    render(<ModeButton mode="dark" onCycle={onCycle} label="Theme" icons={{ light: 'L', dark: 'D', system: 'S' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(onCycle).toHaveBeenCalledOnce();
  });
});

describe('LanguageMenu', () => {
  it('offers every language as a radio item and reports the choice', () => {
    const onSelect = vi.fn();
    render(
      <LanguageMenu
        label="Language"
        current="en"
        icon="G"
        languages={[{ code: 'en', label: 'English' }, { code: 'de', label: 'Deutsch' }]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Deutsch' }));
    expect(onSelect).toHaveBeenCalledWith('de');
  });
});

describe('the markers a design restyles by', () => {
  it('give a link the button marker and classes, and the bar its topbar marker', () => {
    render(
      <TopBar>
        <a href="/x" {...buttonAttributes({ variant: 'outline', size: 'lg' })}>Go</a>
      </TopBar>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('data-ui', 'button');
    expect(link).toHaveAttribute('data-variant', 'outline');
    expect(link.className).toContain('rounded-btn');
    expect(link.closest('header')).toHaveAttribute('data-ui', 'topbar');
  });
});

describe('Drawer', () => {
  it('renders nothing while closed', () => {
    render(<Drawer open={false} onClose={() => {}} label="Navigation">item</Drawer>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a labelled modal dialog with focus inside, closed by Escape and by the scrim', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer open onClose={onClose} label="Navigation">
        <button type="button">first</button>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // jsdom has no layout, so the trap lands on the panel rather than its first visible control.
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the page behind from scrolling while open, and restores it on close', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = render(<Drawer open onClose={() => {}} label="Navigation">item</Drawer>);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Drawer open={false} onClose={() => {}} label="Navigation">item</Drawer>);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('keeps the page locked until the last overlay over it closes', () => {
    document.body.style.overflow = '';
    const drawer = render(<Drawer open onClose={() => {}} label="Navigation">item</Drawer>);
    const dialog = render(<BaseDialog open onClose={() => {}} title="D"><div>body</div></BaseDialog>);
    dialog.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    const second = render(<Drawer open onClose={() => {}} label="Second">item</Drawer>);
    drawer.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    second.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Card', () => {
  it('paints the signature card graphic only when asked', () => {
    const { rerender } = render(<Card data-testid="card" />);
    expect(screen.getByTestId('card').className).not.toContain('--sig-card-l');
    rerender(<Card data-testid="card" graphic />);
    expect(screen.getByTestId('card').className).toContain('bg-[image:var(--sig-card-l)]');
  });
});
