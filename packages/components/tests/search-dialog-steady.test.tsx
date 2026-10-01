import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseDialog } from '../src/composites/BaseDialog.js';
import { SearchDialog, type SearchDialogColumn, type SearchDialogProps } from '../src/composites/SearchDialog.js';

// A search dialog stands at its size from the moment it opens: rows that arrive, go or change
// never resize it, so it never re-centres under the pointer. jsdom lays out nothing, so a size is
// read from the classes that set it: a panel that follows its content carries only the cap
// `max-h-[90vh]`; one that stands at its size carries a height of its own, the full screen on a
// phone (`h-dvh`) and 90% of the screen from `sm` up (`sm:h-[90vh]`).

interface Row {
  _id: string;
  name: string;
}

const NAME: SearchDialogColumn = { key: 'name', label: 'Name' };
const CITY: SearchDialogColumn = { key: 'city', label: 'City' };
const PHONE: SearchDialogColumn = { key: 'phone', label: 'Phone' };
const ROWS: Row[] = [
  { _id: 'a', name: 'Acme Inc' },
  { _id: 'b', name: 'Beta Corp' },
];
const SIZE_OF_SCREEN = ['h-dvh', 'sm:h-[90vh]'];

function Search(props: Partial<SearchDialogProps<Row>>) {
  return (
    <SearchDialog<Row>
      open
      onClose={() => {}}
      title="Customer"
      query=""
      onQueryChange={() => {}}
      columns={[NAME]}
      rows={[]}
      getRowId={(row) => row._id}
      onPick={() => {}}
      {...props}
    />
  );
}

const findPanel = () => screen.getByRole('dialog');

describe('a search dialog stands at its size', () => {
  it('has the same height before and after its rows arrive: the height of the screen', () => {
    const view = render(<Search rows={[]} loading />);
    const before = findPanel().className;
    view.rerender(<Search rows={ROWS} />);
    expect(findPanel().className).toBe(before);
    expect(findPanel()).toHaveClass(...SIZE_OF_SCREEN);
    expect(findPanel()).not.toHaveClass('max-h-[90vh]');
  });

  it('keeps its height when a query finds nothing', () => {
    const view = render(<Search rows={ROWS} />);
    view.rerender(<Search rows={[]} />);
    expect(findPanel()).toHaveClass(...SIZE_OF_SCREEN);
  });

  it('is wider for three columns than for two, so the columns fit', () => {
    const view = render(<Search columns={[NAME, CITY]} />);
    expect(findPanel()).toHaveAttribute('data-size', 'lg');
    view.rerender(<Search columns={[NAME, CITY, PHONE]} />);
    expect(findPanel()).toHaveAttribute('data-size', 'xl');
  });

  it('leaves a dialog that is no picker as tall as its content', () => {
    render(
      <BaseDialog open onClose={() => {}} title="Submit SO-0042?">
        Submitting freezes the prices on this order.
      </BaseDialog>,
    );
    expect(findPanel()).toHaveClass('max-h-[90vh]');
    expect(findPanel()).not.toHaveClass('h-dvh');
  });
});

describe('a search dialog keeps its rows while the next query loads', () => {
  it('keeps the rows of the previous query on screen and marks the results busy', () => {
    render(<Search rows={ROWS} stale />);
    const results = screen.getByRole('table');
    expect(within(results).getByText('Acme Inc')).toBeInTheDocument();
    expect(within(results).getByText('Beta Corp')).toBeInTheDocument();
    expect(results).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Searching…')).toBeNull();
  });

  it('picks no row of the previous query, by Enter or by a click, until the next answer lands', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const view = render(<Search rows={ROWS} stale onPick={onPick} />);
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('{Enter}');
    await user.click(screen.getByText('Beta Corp'));
    expect(onPick).not.toHaveBeenCalled();

    view.rerender(<Search rows={ROWS} onPick={onPick} />);
    expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy');
    await user.click(screen.getByText('Beta Corp'));
    expect(onPick).toHaveBeenCalledWith(ROWS[1]);
  });

  it('still shows the loading line while the first rows are on their way', () => {
    render(<Search rows={[]} loading />);
    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });
});
