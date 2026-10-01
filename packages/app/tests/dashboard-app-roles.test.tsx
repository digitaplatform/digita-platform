// @vitest-environment jsdom
// The visitor of a demo tenant signs in as a user who holds only roles of the app, here the
// workshop's Reception and Technician. The engine lists it the workspaces that name one of its
// roles and refuses it every View definition, so Home must draw the workspace from the workspaces
// and the view results alone, its list headed by the field labels of the entity the section read.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fixtures = vi.hoisted(() => {
  const workspace = (_id: string, name: string, role: string, priority: number) => ({
    _id,
    name,
    enabled: true,
    priority,
    roles: [role],
    is_default_for_roles: [role],
    default_view: 'workshop-overview',
    cards: [{ id: 'today', kind: 'list', label: 'Today', section: 'today_appointments', columns: ['subject', 'customer'] }],
  });
  return {
    // The engine's answer to this user's list: only the workspaces that name one of its roles.
    workspaces: [
      workspace('workshop-reception', 'Reception', 'Reception', 10),
      workspace('workshop-technician', 'Technician', 'Technician', 20),
    ],
  };
});

const resource = vi.hoisted(() => ({
  getList: vi.fn(async () => ({
    success: true,
    data: structuredClone(fixtures.workspaces),
    meta: { total: 2, page: 1, page_size: 100, total_pages: 1 },
  })),
  getDoc: vi.fn(async (entity: string, name: string) =>
    entity === 'Workspace'
      ? { success: true, data: structuredClone(fixtures.workspaces.find((w) => w._id === name)) }
      : { success: false, status_code: 403, error: { detail: `Permission denied: demo@show.test cannot read ${entity}` } },
  ),
  getView: vi.fn(async () => viewResult({ today_appointments: 'Appointment' })),
}));

// The view result, with the entities of its sections, or without them as an older engine answers.
function viewResult(entities?: Record<string, string>) {
  return {
    success: true,
    data: {
      source: null,
      sections: { today_appointments: [{ _id: 'A-1', subject: 'Brake check', customer: 'Acme' }] },
      ...(entities ? { entities } : {}),
    },
    messages: [],
  };
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({
      user: { email: 'demo@show.test', roles: ['Reception', 'Technician'] },
      default_workspace: 'workshop-reception',
      locale: { format_locale: 'en-GB' },
    }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));
vi.mock('@/services/resource', () => resource);
vi.mock('@/services/meta', () => ({
  getEntityMeta: async (entity: string) =>
    entity === 'Appointment'
      ? {
          success: true,
          data: {
            name: 'Appointment',
            label: 'Appointment',
            fields: [
              { fieldname: 'subject', fieldtype: 'Data', label: 'Subject' },
              { fieldname: 'customer', fieldtype: 'Data', label: 'Customer' },
            ],
          },
        }
      : { success: false, status_code: 404, error: { detail: `Entity "${entity}" is not registered` } },
}));

import DashboardPage from '@/pages/DashboardPage';

function drawHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

async function findTodayTable(): Promise<HTMLElement> {
  expect(await screen.findByRole('heading', { level: 1, name: 'Reception' })).toBeInTheDocument();
  const card = within(screen.getByRole('heading', { name: 'Today' }).closest<HTMLElement>('[data-ui="card"]')!);
  return card.findByRole('table');
}

const headers = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((header) => header.textContent);

describe('Home of a user who holds only roles of the app', () => {
  it('draws the workspace of its role with the field labels of the section it read, and opens no View', async () => {
    drawHome();
    const table = await findTodayTable();
    expect(headers(table)).toEqual(['Subject', 'Customer']);
    expect(within(table).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Brake check', 'Acme']);
    expect(resource.getDoc.mock.calls.filter(([entity]) => entity === 'View')).toEqual([]);
  });

  it('draws the workspace with the keys as headers when the view result names no entities', async () => {
    resource.getView.mockImplementationOnce(async () => viewResult());
    drawHome();
    expect(headers(await findTodayTable())).toEqual(['subject', 'customer']);
  });
});
