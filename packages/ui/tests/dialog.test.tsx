// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BaseDialog, SearchDialog } from '@digitaplatform/components';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no layout; SearchDialog scrolls the active row into view on render.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
});

type R = { _id: string; code: string; name: string };
const COLS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Name' },
];
const ROWS: R[] = [
  { _id: 'p1', code: 'A1', name: 'Apple' },
  { _id: 'p2', code: 'B2', name: 'Banana' },
];

describe('BaseDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <BaseDialog open={false} onClose={() => {}} title="X">
        body
      </BaseDialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders title + children when open', () => {
    render(
      <BaseDialog open onClose={() => {}} title="My Dialog">
        hello-body
      </BaseDialog>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('My Dialog')).toBeTruthy();
    expect(screen.getByText('hello-body')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <BaseDialog open onClose={onClose} title="X">
        b
      </BaseDialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the close button', () => {
    const onClose = vi.fn();
    render(
      <BaseDialog open onClose={onClose} title="X" closeLabel="Close">
        b
      </BaseDialog>,
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <BaseDialog open onClose={onClose} title="X">
        b
      </BaseDialog>,
    );
    const overlay = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SearchDialog', () => {
  it('renders columns and rows', () => {
    render(
      <SearchDialog<R>
        open
        onClose={() => {}}
        title="Search"
        query=""
        onQueryChange={() => {}}
        columns={COLS}
        rows={ROWS}
        getRowId={(r) => r._id}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText('Code')).toBeTruthy();
    expect(screen.getByText('Apple')).toBeTruthy();
    expect(screen.getByText('Banana')).toBeTruthy();
  });

  it('reports query changes', () => {
    const onQueryChange = vi.fn();
    render(
      <SearchDialog<R>
        open
        onClose={() => {}}
        query=""
        onQueryChange={onQueryChange}
        columns={COLS}
        rows={ROWS}
        getRowId={(r) => r._id}
        onPick={() => {}}
        searchPlaceholder="Find"
      />,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'app' } });
    expect(onQueryChange).toHaveBeenCalledWith('app');
  });

  it('picks the active row on Enter after ArrowDown', () => {
    const onPick = vi.fn();
    render(
      <SearchDialog<R>
        open
        onClose={() => {}}
        query=""
        onQueryChange={() => {}}
        columns={COLS}
        rows={ROWS}
        getRowId={(r) => r._id}
        onPick={onPick}
      />,
    );
    const box = screen.getByRole('searchbox');
    fireEvent.keyDown(box, { key: 'ArrowDown' }); // 0 -> 1
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(ROWS[1]);
  });

  it('picks a row on click', () => {
    const onPick = vi.fn();
    render(
      <SearchDialog<R>
        open
        onClose={() => {}}
        query=""
        onQueryChange={() => {}}
        columns={COLS}
        rows={ROWS}
        getRowId={(r) => r._id}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByText('Apple'));
    expect(onPick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('shows empty and loading states', () => {
    const { rerender } = render(
      <SearchDialog<R>
        open
        onClose={() => {}}
        query="x"
        onQueryChange={() => {}}
        columns={COLS}
        rows={[]}
        getRowId={(r) => r._id}
        onPick={() => {}}
        emptyLabel="Nothing"
      />,
    );
    expect(screen.getByText('Nothing')).toBeTruthy();
    rerender(
      <SearchDialog<R>
        open
        onClose={() => {}}
        query="x"
        onQueryChange={() => {}}
        columns={COLS}
        rows={[]}
        getRowId={(r) => r._id}
        onPick={() => {}}
        loading
        loadingLabel="Loading…"
      />,
    );
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});
