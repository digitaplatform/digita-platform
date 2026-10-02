// @vitest-environment jsdom
// The app's left menu, drawn from the entity with `tree.menu: "app"`. The engine answers only the
// nodes a person's roles meet; the menu draws a node only under a drawn parent, a node with children
// as a section, and leaves out a node without children and without a target.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildAppMenu } from '@/plugins/app-menu/menu-tree';

const state = vi.hoisted(() => ({
  catalog: [] as Array<{ name: string; tree?: { menu?: string } }>,
  rows: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/hooks/useMeta', () => ({
  useMetaCatalog: () => ({ data: state.catalog, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useList', () => ({
  useList: (entity: string | undefined) => ({ data: entity ? { rows: state.rows } : undefined, isLoading: false, isError: false }),
}));
vi.mock('@digitaplatform/plugins', async (original) => ({
  ...(await original<typeof import('@digitaplatform/plugins')>()),
  useHost: () => ({ t: (key: string) => key, closeMobileNav: () => {} }),
}));

import { AppMenu } from '@/plugins/app-menu/AppMenu';

// The workshop's three sections, as the engine answers them to an Administrator.
const LEAD = [
  { _id: 'lead', label: 'Workshop lead', parent: null, position: 1 },
  { _id: 'lead-orders', label: 'All orders', parent: 'lead', position: 1, target_entity: 'WorkOrder' },
];
const RECEPTION = [
  { _id: 'reception', label: 'Reception', parent: null, position: 2 },
  { _id: 'reception-open', label: 'Open orders', parent: 'reception', position: 1, target_entity: 'WorkOrder', filter_json: { status: 'Open' } },
];
const TECHNICIAN = [
  { _id: 'technician', label: 'Technician', parent: null, position: 3 },
  { _id: 'technician-mine', label: 'My jobs', parent: 'technician', position: 1, target_url: '/WorkOrder?mine=1' },
  { _id: 'technician-manual', label: 'Manual', parent: 'technician', position: 2, target_url: 'https://manuals.example.org/bikes' },
];

const labels = (nodes: ReturnType<typeof buildAppMenu>) => nodes.map((n) => [n.label, n.children.map((c) => c.label)]);

describe('buildAppMenu', () => {
  it('gives an Administrator all three sections, one under the other', () => {
    expect(labels(buildAppMenu([...TECHNICIAN, ...RECEPTION, ...LEAD]))).toEqual([
      ['Workshop lead', ['All orders']],
      ['Reception', ['Open orders']],
      ['Technician', ['My jobs', 'Manual']],
    ]);
  });

  it('PLANTED DEFECT: gives Reception its section only, and no node whose parent the engine withheld', () => {
    // The engine answers Reception's rows; a lead entry whose roles also name Reception arrives
    // without its section, so it is not drawn.
    const rows = [...RECEPTION, { _id: 'lead-reports', label: 'Reports', parent: 'lead', position: 2, target_entity: 'Report' }];
    expect(labels(buildAppMenu(rows))).toEqual([['Reception', ['Open orders']]]);
  });

  it('leaves out a switched-off node with its subtree, and a node without children and without a target', () => {
    const rows = [...LEAD, { ...RECEPTION[0]!, active: 0 }, RECEPTION[1]!, { _id: 'empty', label: 'Empty', parent: null, position: 9 }];
    expect(labels(buildAppMenu(rows))).toEqual([['Workshop lead', ['All orders']]]);
  });

  it('opens a list with its filter, a path in the app, and an absolute address outside it', () => {
    const [, reception, technician] = buildAppMenu([...LEAD, ...RECEPTION, ...TECHNICIAN]);
    expect(reception!.children[0]!.target).toEqual({ kind: 'path', to: `/WorkOrder?filter=${encodeURIComponent('{"status":"Open"}')}` });
    expect(technician!.children.map((c) => c.target)).toEqual([
      { kind: 'path', to: '/WorkOrder?mine=1' },
      { kind: 'external', href: 'https://manuals.example.org/bikes' },
    ]);
  });
});

describe('AppMenu', () => {
  beforeEach(() => {
    state.catalog = [{ name: 'WorkOrder' }, { name: 'AppMenuNode', tree: { menu: 'app' } }];
    state.rows = [...LEAD, ...RECEPTION, ...TECHNICIAN];
  });

  const renderMenu = () =>
    render(
      <MemoryRouter>
        <AppMenu />
      </MemoryRouter>,
    );

  it('draws each section under its heading, and opens an absolute address in a new tab', () => {
    renderMenu();
    const technician = screen.getByRole('region', { name: 'Technician' });
    expect(within(technician).getByRole('link', { name: 'My jobs' })).toHaveAttribute('href', '/WorkOrder?mine=1');
    const manual = within(technician).getByRole('link', { name: 'Manual' });
    expect(manual).toHaveAttribute('href', 'https://manuals.example.org/bikes');
    expect(manual).toHaveAttribute('target', '_blank');
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Workshop lead', 'Reception', 'Technician']);
  });

  it('draws nothing for an app without a menu entity', () => {
    state.catalog = [{ name: 'WorkOrder' }];
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });
});
