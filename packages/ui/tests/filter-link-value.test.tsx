// @vitest-environment jsdom
// The list filter's Link value picker now IS the shared Combobox — same
// keyboard contract as the form LinkControl (no more copy-paste drift).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition } from '@digitaplatform/shared';
import type { FilterTuple } from '@/lib/filter-from-url';

vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({
    data: [
      { _id: 'O-1', display: 'Alpha' },
      { _id: 'O-2', display: 'Beta' },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tField: (_e: string, _f: string, label: string) => label, tOption: (_e: string, _f: string, o: string) => o }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import { FilterEditor } from '@/components/list/FilterEditor';

const META: EntityDefinition = {
  name: 'Widget',
  module: 'core',
  database: 'app',
  naming: { strategy: 'system' },
  fields: [
    {
      fieldname: 'owner',
      fieldtype: 'Link',
      label: 'Owner',
      target: 'Owner',
      in_standard_filter: true,
    },
  ],
  permissions: [],
} as unknown as EntityDefinition;

function Host({ onChange }: { onChange: (t: FilterTuple) => void }) {
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <FilterEditor
        meta={META}
        filter={['owner', '=', ''] as FilterTuple}
        onChange={onChange}
        onRemove={() => {}}
      />
    </form>
  );
}

describe('FilterEditor Link value via shared Combobox', () => {
  it('picking an option emits the tuple with the target id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'ui.filter.value' });
    await user.click(box);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith(['owner', '=', 'O-1']);
  });

  it('Enter with no highlight never bubbles into a form submit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'ui.filter.value' });
    await user.click(box);
    await user.keyboard('{Enter}'); // no highlight yet (APG: open ≠ pre-selected)
    expect(onChange).not.toHaveBeenCalled();
  });
});
