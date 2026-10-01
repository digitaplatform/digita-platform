// @vitest-environment jsdom
// The design showcase draws each DatePicker under a visible label that names it, as a record form
// does: a screen reader user tells the four states apart, and the calendar of each is named too.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GalleryComposites } from '@/components/design-showcase/GalleryComposites';

const triggers = () =>
  within(document.querySelector<HTMLElement>('[data-showcase-group="DatePicker"]')!)
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-haspopup') === 'dialog');

describe('the DatePicker group of the design showcase', () => {
  it('names each trigger by a visible label of its own', () => {
    render(<GalleryComposites />);
    expect(triggers()).toHaveLength(4);
    for (const t of triggers()) expect(document.getElementById(t.getAttribute('aria-labelledby') ?? '')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Order date' })).toBe(triggers()[0]);
    expect(screen.getByRole('button', { name: 'Delivery date' })).toBe(triggers()[1]);
    expect(screen.getByRole('button', { name: 'Due date' })).toBe(triggers()[2]);
    expect(screen.getByRole('button', { name: 'Posting date' })).toBe(triggers()[3]);
  });

  it('names the open calendar by the label of its trigger', async () => {
    const user = userEvent.setup();
    render(<GalleryComposites />);
    await user.click(screen.getByRole('button', { name: 'Order date' }));
    expect(screen.getByRole('dialog', { name: 'Order date' })).toBeInTheDocument();
  });

  it('still shows the date or the placeholder in each trigger (innocent case)', () => {
    render(<GalleryComposites />);
    expect(triggers().map((t) => t.textContent)).toEqual(['28/09/2026', 'Delivery date', 'Required', '28/09/2026']);
  });
});
