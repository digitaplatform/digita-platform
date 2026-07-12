// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * RecordDialog — the modal record editor used by the tree/group manager:
 *  1. renders the ancestry breadcrumb so the operator sees where a node sits
 *  2. a create saves via useCreate.mutateAsync and reports the doc through onSaved
 * FormRenderer + the IO hooks are mocked; the real save wiring (RHF + zod +
 * stripForSave) stays under test.
 */

const createMock = vi.fn().mockResolvedValue({ _id: 'new-1', name: 'Phones', modified: 'T1' });
const updateMock = vi.fn();

vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdate: () => ({ mutateAsync: updateMock, isPending: false }),
}));
vi.mock('@/components/render/FormRenderer', () => ({ FormRenderer: () => null }));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) =>
    sel({ user: { roles: ['Administrator'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (
    sel: (s: { t: (k: string) => string; tEntity: (e: string, fb?: string) => string }) => unknown,
  ) => sel({ t: (k: string) => k, tEntity: (e: string, fb?: string) => fb ?? e }),
}));

import { RecordDialog } from '@/components/record/RecordDialog';

const META = {
  name: 'ProductCategory',
  label: 'Product Category',
  title_field: 'name',
  fields: [{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RecordDialog', () => {
  it('renders the ancestry breadcrumb', () => {
    render(
      <RecordDialog
        open
        onClose={vi.fn()}
        entity="ProductCategory"
        meta={META}
        seed={{ parent_category: 'p1' }}
        ancestry={['Electronics', 'Phones']}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText('Electronics')).toBeTruthy();
    expect(screen.getByText('Phones')).toBeTruthy();
  });

  it('creates via useCreate and reports the saved doc through onSaved', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <RecordDialog
        open
        onClose={onClose}
        entity="ProductCategory"
        meta={META}
        seed={{ parent_category: 'p1' }}
        onSaved={onSaved}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ui.action.create' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    // the parent pre-fill from the seed reaches the create body
    expect(createMock.mock.calls[0]![0]).toMatchObject({ parent_category: 'p1' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ _id: 'new-1' })));
    expect(onClose).toHaveBeenCalled();
  });
});
