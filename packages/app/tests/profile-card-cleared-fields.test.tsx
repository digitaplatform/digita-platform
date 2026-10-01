// @vitest-environment jsdom
// The profile card of the account page. digita-auth keeps a field the body leaves out and stores
// an empty one: an emptied name must reach it as "", and "System default" as language "", which
// clears the stored language.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileCard } from '@/components/account/ProfileCard';
import type { BootLanguage, SessionUser } from '@/types';

const user: SessionUser = { _id: 'u1', email: 'ada@example.com', roles: [], full_name: 'Ada Lovelace', language: 'de' };
const languages: BootLanguage[] = [
  { code: 'en', native_name: 'English' },
  { code: 'de', native_name: 'Deutsch' },
];

/** The body the card hands to the save, as the API client sends it. */
function renderCard() {
  const onSave = vi.fn();
  const { container } = render(<ProfileCard user={user} languages={languages} onSave={onSave} saving={false} />);
  return {
    container,
    sentBody: () => JSON.stringify(onSave.mock.calls[0]![0]),
    save: () => fireEvent.click(screen.getByRole('button', { name: 'Save profile' })),
  };
}

describe('the profile card', () => {
  it('sends an emptied name as an empty name', () => {
    const card = renderCard();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '' } });
    card.save();
    expect(card.sentBody()).toBe('{"full_name":""}');
  });

  it('sends the system default as an empty language', () => {
    const card = renderCard();
    fireEvent.click(card.container.querySelector('[data-ui="select-trigger"]')!);
    fireEvent.click(screen.getByRole('option', { name: 'System default' }));
    card.save();
    expect(card.sentBody()).toBe('{"language":""}');
  });

  it('sends a changed name without its outer spaces', () => {
    const card = renderCard();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  Grace Hopper ' } });
    card.save();
    expect(JSON.parse(card.sentBody())).toMatchObject({ full_name: 'Grace Hopper' });
  });
});
