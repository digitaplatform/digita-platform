// @vitest-environment jsdom
// EntryContextBar: compact per-row context (a metric / last rate / summary)
// under an entry_flow grid, fed by a declarative View with mapped params.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const viewCalls = vi.hoisted(() => ({ calls: [] as Array<{ name: string; params: Record<string, string> }> }));
vi.mock('@/services/resource', () => ({
  getView: (name: string, params: Record<string, string>) => {
    viewCalls.calls.push({ name, params });
    return Promise.resolve({
      success: true,
      status_code: 200,
      data: {
        source: null,
        sections: {
          metric: { available: 42 },
          last_rate: [{ rate: 1.55, at_date: '2026-06-01' }],
        },
      },
      messages: [],
    });
  },
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { EntryContextBar } from '@/controls/EntryContextBar';

const PARAMS = { part: 'part', bin: 'bin', owner: '$doc.owner' };

beforeEach(() => {
  viewCalls.calls = [];
});

describe('EntryContextBar', () => {
  it('does not fetch while the row lacks the first mapped param (part)', () => {
    render(
      <EntryContextBar view="rowContext" paramsMap={PARAMS} row={{}} doc={{ owner: 'O-1' }} />,
    );
    expect(viewCalls.calls).toHaveLength(0);
  });

  it('fetches with row fields and $doc tokens mapped, omitting empty optionals', async () => {
    render(
      <EntryContextBar
        view="rowContext"
        paramsMap={PARAMS}
        row={{ part: 'P-1' }}
        doc={{ owner: 'O-1' }}
      />,
    );
    await waitFor(() => expect(viewCalls.calls).toHaveLength(1));
    expect(viewCalls.calls[0]).toEqual({
      name: 'rowContext',
      params: { part: 'P-1', owner: 'O-1' },
    });
  });

  it('renders the section values compactly', async () => {
    render(
      <EntryContextBar
        view="rowContext"
        paramsMap={PARAMS}
        row={{ part: 'P-1', bin: 'B-1' }}
        doc={{ owner: 'O-1' }}
      />,
    );
    expect(await screen.findByText(/42/)).toBeInTheDocument();
    expect(screen.getByText(/1.55/)).toBeInTheDocument();
  });

  it('re-fetches when the row part changes', async () => {
    const { rerender } = render(
      <EntryContextBar view="rowContext" paramsMap={PARAMS} row={{ part: 'P-1' }} doc={{}} />,
    );
    await waitFor(() => expect(viewCalls.calls).toHaveLength(1));
    rerender(
      <EntryContextBar view="rowContext" paramsMap={PARAMS} row={{ part: 'P-2' }} doc={{}} />,
    );
    await waitFor(() => expect(viewCalls.calls).toHaveLength(2));
    expect(viewCalls.calls[1]!.params.part).toBe('P-2');
  });
});
