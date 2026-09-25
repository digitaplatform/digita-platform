// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ListPreferenceDoc } from '@/services/listPreference';

/**
 * Saved-views (Weg-B) UI contract: the ViewPicker addresses every control by a
 * meta-derived data-testid (tid.view) — never by i18n label — and fires the right
 * callback for apply / all-records / update / delete / set-default / save-as.
 * Pure component: callbacks are spies; only useChrome + useFocusTrap are stubbed.
 */

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/lib/use-focus-trap', () => ({ useFocusTrap: () => {} }));

import { ViewPicker } from '@/components/list/ViewPicker';

const VIEW = {
  _id: 'v1',
  view_name: 'My View',
  visibility: 'private',
  filters: [],
} as unknown as ListPreferenceDoc;

function setup(overrides: Record<string, unknown> = {}) {
  const cb = {
    onApply: vi.fn(),
    onReset: vi.fn(),
    onAllRecords: vi.fn(),
    onSaveAs: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onSetDefault: vi.fn(),
    onClearDefault: vi.fn(),
    onSetOrgDefault: vi.fn(),
    onClearOrgDefault: vi.fn(),
  };
  const utils = render(
    // active + modified + canSave + admin + editable → every per-view control renders
    <ViewPicker
      views={[VIEW]}
      activeId="v1"
      modified
      canSave
      isAdmin
      canEdit={() => true}
      {...cb}
      {...overrides}
    />,
  );
  return { ...utils, cb };
}

afterEach(cleanup);

describe('ViewPicker (saved views)', () => {
  it('opens via the menu trigger and applies a view by id', async () => {
    const { getByTestId, queryByTestId, cb } = setup({ activeId: undefined, modified: false });
    expect(queryByTestId('view:apply:v1')).toBeNull(); // closed
    await userEvent.click(getByTestId('view:menu'));
    await userEvent.click(getByTestId('view:apply:v1'));
    expect(cb.onApply).toHaveBeenCalledWith('v1');
  });

  it('clears to all records', async () => {
    const { getByTestId, cb } = setup();
    await userEvent.click(getByTestId('view:menu'));
    await userEvent.click(getByTestId('view:all'));
    expect(cb.onAllRecords).toHaveBeenCalledTimes(1);
  });

  it('updates / deletes / sets default the active view', async () => {
    const { getByTestId, cb } = setup();
    await userEvent.click(getByTestId('view:menu'));
    await userEvent.click(getByTestId('view:update:v1'));
    expect(cb.onUpdate).toHaveBeenCalledWith('v1');

    await userEvent.click(getByTestId('view:menu')); // reopen (update closed it)
    await userEvent.click(getByTestId('view:default:v1'));
    expect(cb.onSetDefault).toHaveBeenCalledWith('v1');

    await userEvent.click(getByTestId('view:delete:v1'));
    expect(cb.onDelete).toHaveBeenCalledWith('v1');
  });

  it('save-as: name + confirm fires onSaveAs (private, no roles/users)', async () => {
    const { getByTestId, cb } = setup();
    await userEvent.click(getByTestId('view:menu'));
    await userEvent.click(getByTestId('view:save-as'));
    await userEvent.type(getByTestId('view:save-as-name'), 'Q3 pipeline');
    await userEvent.click(getByTestId('view:save-as-confirm'));
    expect(cb.onSaveAs).toHaveBeenCalledWith('Q3 pipeline', 'private', [], []);
  });
});
