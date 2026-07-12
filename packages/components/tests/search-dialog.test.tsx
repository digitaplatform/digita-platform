import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchDialog, type SearchDialogColumn } from '../src/composites/SearchDialog.js';

interface TestRow {
  _id: string;
  name: string;
}

const COLUMNS: SearchDialogColumn[] = [
  { key: 'name', label: 'Name' },
];

const TEST_ROWS: TestRow[] = [
  { _id: 'x', name: 'Acme Inc' },
  { _id: 'y', name: 'Beta Corp' },
];

function Host({
  initialLoading = false,
  onPick = () => {},
}: {
  initialLoading?: boolean;
  onPick?: (row: TestRow) => void;
} = {}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(initialLoading);
  const [open, setOpen] = useState(true);

  return (
    <>
      <button onClick={() => setLoading(false)}>finish loading</button>
      <SearchDialog<TestRow>
        open={open}
        onClose={() => setOpen(false)}
        title="Search"
        query={query}
        onQueryChange={setQuery}
        columns={COLUMNS}
        rows={TEST_ROWS}
        getRowId={(row) => row._id}
        onPick={onPick}
        loading={loading}
        searchPlaceholder="Search…"
      />
    </>
  );
}

describe('SearchDialog loading guard', () => {
  it('does NOT pick a row when Enter is pressed while loading=true', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<Host initialLoading={true} onPick={onPick} />);

    // While loading, press Enter
    const input = screen.getByRole('searchbox');
    await user.click(input);
    await user.keyboard('{Enter}');

    // onPick should NOT have been called
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picks the active row when Enter is pressed with loading=false', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    const { rerender } = render(<Host initialLoading={false} onPick={onPick} />);

    // Press Enter while loading=false
    const input = screen.getByRole('searchbox');
    await user.click(input);
    await user.keyboard('{Enter}');

    // onPick should have been called with the first (active) row
    expect(onPick).toHaveBeenCalledWith(TEST_ROWS[0]);
  });

  it('transitions from loading=true to loading=false and allows Enter to pick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<Host initialLoading={true} onPick={onPick} />);

    // While loading, press Enter — should not pick
    const input = screen.getByRole('searchbox');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();

    // Now finish loading
    const finishButton = screen.getByRole('button', { name: 'finish loading' });
    await user.click(finishButton);

    // Press Enter again — should now pick
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(TEST_ROWS[0]);
  });

  it('does NOT pick a row when clicking while loading=true', async () => {
    const onPick = vi.fn();

    render(<Host initialLoading={true} onPick={onPick} />);

    // While loading=true, rows are not rendered (they are inside {!loading && rows.map(...)})
    // so there's nothing to click — verify no data rows exist
    expect(screen.queryByText('Acme Inc')).not.toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picks a row when clicking with loading=false', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<Host initialLoading={false} onPick={onPick} />);

    // Find the first row by its content and click it
    const firstRow = screen.getByText('Acme Inc').closest('tr');
    expect(firstRow).toBeInTheDocument();

    await user.click(firstRow!);

    // onPick should have been called with the first row
    expect(onPick).toHaveBeenCalledWith(TEST_ROWS[0]);
  });
});

// ---------------------------------------------------------------------------
// Active-row stability (F3): the highlight must track the query RESULTS, and a
// stray mouse-move / stale hover must never make Enter pick an unintended row.
// ---------------------------------------------------------------------------

const CATALOG: TestRow[] = [
  { _id: 'a', name: 'Acme Inc' },
  { _id: 'b', name: 'Beta Corp' },
  { _id: 'g', name: 'Gamma Ltd' },
];

/**
 * Mirrors the real LinkControl usage: `rows` are derived from the (controlled)
 * query, so a keystroke replaces the whole result set with fresh row objects —
 * exactly the situation that races with the highlight/hover state.
 */
function FilterHost({ onPick }: { onPick: (row: TestRow) => void }) {
  const [query, setQuery] = useState('');
  const rows = query
    ? CATALOG.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
    : CATALOG;
  return (
    <SearchDialog<TestRow>
      open
      onClose={() => {}}
      title="Search"
      query={query}
      onQueryChange={setQuery}
      columns={COLUMNS}
      rows={rows}
      getRowId={(row) => row._id}
      onPick={onPick}
      loading={false}
      searchPlaceholder="Search…"
    />
  );
}

describe('SearchDialog active-row stability (F3)', () => {
  it('type → results update → highlighted row is the first result → Enter picks it', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<FilterHost onPick={onPick} />);
    const input = screen.getByRole('searchbox');
    await user.click(input);

    // Type a query that filters down to a NEW result set whose first row differs
    // from the previously-highlighted (index 0) row of the unfiltered list.
    await user.type(input, 'beta');

    // Only "Beta Corp" survives; it is the first (and only) result and must be
    // the highlighted row.
    const betaRow = screen.getByText('Beta Corp').closest('tr')!;
    expect(betaRow).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Acme Inc')).not.toBeInTheDocument();

    // Enter picks the highlighted (first matching) row — not the stale index-0
    // row of the old unfiltered list.
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ _id: 'b', name: 'Beta Corp' });
  });

  it('resets the highlight to the first row when the result set changes after a real hover', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<FilterHost onPick={onPick} />);
    const input = screen.getByRole('searchbox');
    await user.click(input);

    // The user genuinely hovers the LAST row (Gamma) with the mouse.
    const gammaRow = screen.getByText('Gamma Ltd').closest('tr')!;
    await user.hover(gammaRow);
    expect(gammaRow).toHaveAttribute('aria-selected', 'true');

    // Now they type: the result set narrows to a fresh list whose first row is
    // NOT the hovered one. The highlight must deterministically jump to the
    // first result, abandoning the stale hover.
    await user.type(input, 'inc'); // matches only "Acme Inc"
    const acmeRow = screen.getByText('Acme Inc').closest('tr')!;
    expect(acmeRow).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Gamma Ltd')).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith({ _id: 'a', name: 'Acme Inc' });
  });

  it('a stray mouseEnter after results change does NOT hijack the keyboard selection', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<FilterHost onPick={onPick} />);
    const input = screen.getByRole('searchbox');
    await user.click(input);

    // Type so the result set changes to a fresh multi-row list — this is the
    // exact moment the old code raced: results land under a stationary cursor.
    await user.type(input, 'm'); // matches "Acme Inc" and "Gamma Ltd"
    const acmeRow = screen.getByText('Acme Inc').closest('tr')!;
    const gammaRow = screen.getByText('Gamma Ltd').closest('tr')!;
    expect(acmeRow).toHaveAttribute('aria-selected', 'true');

    // Simulate the re-render-under-a-stationary-cursor case: a bare mouseEnter
    // on a lower row WITHOUT any preceding mouse movement. It must be ignored.
    fireEvent.mouseEnter(gammaRow);
    expect(acmeRow).toHaveAttribute('aria-selected', 'true');
    expect(gammaRow).toHaveAttribute('aria-selected', 'false');

    // …so Enter picks the intended first row, not the row the stray event touched.
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith({ _id: 'a', name: 'Acme Inc' });
  });

  it('resets the highlight to the first row when RESULTS change (not the query) after arrow nav', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    // Models the debounced-fetch reality: the row set updates independently of
    // the typed query (here via an explicit swap). The old code reset the
    // highlight on `query`, so a results-only change left `active` stranded on a
    // stale index — with `rowsKey` it deterministically snaps back to the first.
    function LazyHost() {
      const [query, setQuery] = useState('');
      const [rows, setRows] = useState<TestRow[]>(CATALOG);
      return (
        <>
          <button
            onClick={() =>
              setRows([
                { _id: 'z', name: 'Zeta' },
                { _id: 'w', name: 'Wako' },
              ])
            }
          >
            load results
          </button>
          <SearchDialog<TestRow>
            open
            onClose={() => {}}
            title="Search"
            query={query}
            onQueryChange={setQuery}
            columns={COLUMNS}
            rows={rows}
            getRowId={(row) => row._id}
            onPick={onPick}
            loading={false}
            searchPlaceholder="Search…"
          />
        </>
      );
    }

    render(<LazyHost />);
    const input = screen.getByRole('searchbox');
    await user.click(input);

    // Move the highlight off the first row via the keyboard.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByText('Beta Corp').closest('tr')).toHaveAttribute('aria-selected', 'true');

    // A fresh result set lands WITHOUT the query changing.
    await user.click(screen.getByRole('button', { name: 'load results' }));
    const zetaRow = screen.getByText('Zeta').closest('tr')!;
    expect(zetaRow).toHaveAttribute('aria-selected', 'true');

    // Enter picks the first row of the NEW result set, not the stale index-1 row.
    await user.click(input); // return focus to the dialog (clicking the button moved it)
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith({ _id: 'z', name: 'Zeta' });
  });

  it('still lets real hover move the highlight, and Enter then picks the hovered row', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<FilterHost onPick={onPick} />);
    const input = screen.getByRole('searchbox');
    await user.click(input);

    // A genuine hover (userEvent.hover emits pointer movement) must still work.
    const betaRow = screen.getByText('Beta Corp').closest('tr')!;
    await user.hover(betaRow);
    expect(betaRow).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith({ _id: 'b', name: 'Beta Corp' });
  });
});
