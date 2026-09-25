// @vitest-environment jsdom
// ImportWizard behavior: meta-driven column auto-mapping, server dry-run error
// table, and the commit path (toast + list invalidation via onImported).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition, ImportReport } from '@digitaplatform/shared';

const toastSpy = vi.hoisted(() => vi.fn());
const importSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: toastSpy }),
}));
vi.mock('@/services/importExport', () => ({
  importRows: importSpy,
}));

import { ImportWizard } from '@/components/list/ImportWizard';

const META = {
  name: 'Item',
  label: 'Item',
  fields: [
    { fieldname: 'item_no', fieldtype: 'Data', label: 'No' },
    { fieldname: 'name', fieldtype: 'Data', label: 'Name' },
    { fieldname: 'group', fieldtype: 'Link', target: 'Group', label: 'Group' },
  ],
  permissions: [],
} as unknown as EntityDefinition;

function report(over: Partial<ImportReport>): ImportReport {
  return {
    mode: 'validate', dry_run: true, total: 0, inserted: 0, updated: 0, skipped: 0,
    failed: 0, errors: [], warnings: [], ...over,
  };
}

function renderWizard(onImported = vi.fn()) {
  return render(
    <ImportWizard entity="Item" meta={META} open onClose={vi.fn()} onImported={onImported} />,
  );
}

beforeEach(() => {
  toastSpy.mockReset();
  importSpy.mockReset();
});

describe('ImportWizard', () => {
  it('auto-maps CSV header columns against the meta and flags unknowns', () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('import-textarea'), {
      target: { value: 'item_no,name,bogus\r\nX,Widget,z' },
    });
    expect(screen.getByTestId('import-mapping')).toBeTruthy();
    const unknown = screen.getByTestId('import-unknown-columns');
    expect(unknown.textContent).toContain('bogus');
  });

  it('dry run renders the server error table (row / field / message)', async () => {
    importSpy.mockResolvedValue({
      data: report({ inserted: 1, failed: 1, errors: [
        { row: 2, field: 'group', message: 'link_not_found' },
      ] }),
    });
    renderWizard();
    fireEvent.change(screen.getByTestId('import-textarea'), {
      target: { value: 'item_no,group\r\nX,NOPE' },
    });
    await userEvent.click(screen.getByTestId('action:import-dry-run'));

    await waitFor(() => expect(screen.getByTestId('import-errors')).toBeTruthy());
    expect(importSpy).toHaveBeenCalledWith('Item', { csv: expect.any(String), mode: 'validate' });
    const rows = screen.getByTestId('import-errors').querySelectorAll('tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('2');
    expect(rows[0]!.textContent).toContain('group');
    expect(rows[0]!.textContent).toContain('link_not_found');
  });

  it('commit posts the chosen mode, toasts, and invalidates via onImported', async () => {
    importSpy.mockResolvedValue({
      data: report({ mode: 'upsert', dry_run: false, inserted: 1, updated: 0, failed: 0 }),
    });
    const onImported = vi.fn();
    renderWizard(onImported);
    fireEvent.change(screen.getByTestId('import-textarea'), {
      target: { value: 'item_no\r\nX' },
    });
    await userEvent.click(screen.getByTestId('action:import-commit'));

    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(importSpy).toHaveBeenCalledWith('Item', { csv: expect.any(String), mode: 'upsert' });
    expect(toastSpy).toHaveBeenCalled();
  });
});
