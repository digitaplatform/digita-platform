// @vitest-environment jsdom
// ContextPanel: metadata-driven side panel for Link fields with context_view.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition } from '@digitaplatform/shared';

const viewCalls = vi.hoisted(() => ({ calls: [] as Array<{ name: string; params: Record<string, string> }>, fail: false }));
vi.mock('@/services/resource', () => ({
  getView: (name: string, params: Record<string, string>) => {
    viewCalls.calls.push({ name, params });
    if (viewCalls.fail) {
      return Promise.resolve({ success: false, status_code: 500, data: null, messages: [{ text: 'boom', type: 'error' }] });
    }
    return Promise.resolve({
      success: true,
      status_code: 200,
      data: {
        source: { _id: params.id, display_name: 'Sample Co' },
        sections: {
          summary: { total: 1200, open_a: 900, open_b: 300 },
          recent: [
            { _id: 'R-1', at_date: '2026-06-01', amount: 500 },
            { _id: 'R-2', at_date: '2026-05-01', amount: 400 },
          ],
          empty_one: null,
        },
      },
      messages: [],
    });
  },
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tField: (_e: string, _f: string, label: string) => label }),
}));

import { ContextPanel } from '@/components/record/ContextPanel';

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
      context_view: 'owner360',
      context_title: 'Owner context',
    },
    { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
  ],
  permissions: [],
} as unknown as EntityDefinition;

beforeEach(() => {
  viewCalls.calls = [];
  viewCalls.fail = false;
});

describe('ContextPanel', () => {
  it('renders nothing when no context field carries a value', () => {
    const { container } = render(<ContextPanel entity="Widget" meta={META} doc={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(viewCalls.calls).toHaveLength(0);
  });

  it('fetches the view with the field value and renders sections', async () => {
    render(<ContextPanel entity="Widget" meta={META} doc={{ owner: 'O-1' }} />);
    await waitFor(() => expect(viewCalls.calls).toHaveLength(1));
    expect(viewCalls.calls[0]).toEqual({ name: 'owner360', params: { id: 'O-1' } });
    expect(await screen.findByText('Owner context')).toBeInTheDocument();
    expect(screen.getByText(/1200/)).toBeInTheDocument(); // aggregate key/value
    expect(screen.getByText('R-1')).toBeInTheDocument(); // list row
  });

  it('re-fetches when the field value changes', async () => {
    const { rerender } = render(<ContextPanel entity="Widget" meta={META} doc={{ owner: 'O-1' }} />);
    await waitFor(() => expect(viewCalls.calls).toHaveLength(1));
    rerender(<ContextPanel entity="Widget" meta={META} doc={{ owner: 'O-2' }} />);
    await waitFor(() => expect(viewCalls.calls).toHaveLength(2));
    expect(viewCalls.calls[1]!.params).toEqual({ id: 'O-2' });
  });

  it('is collapsible', async () => {
    const user = userEvent.setup();
    render(<ContextPanel entity="Widget" meta={META} doc={{ owner: 'O-1' }} />);
    await screen.findByText(/1200/);
    await user.click(screen.getByRole('button', { name: 'Owner context' }));
    expect(screen.queryByText(/1200/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Owner context' }));
    expect(await screen.findByText(/1200/)).toBeInTheDocument();
  });

  it('shows a compact error instead of crashing when the view fails', async () => {
    viewCalls.fail = true;
    render(<ContextPanel entity="Widget" meta={META} doc={{ owner: 'O-1' }} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
