// @vitest-environment jsdom
// The record's history panel: once opened, it shows the versions, the activity stream and, for
// an entity with `track_views`, the views, each as its route answers it, and a failed read as an
// error. It reads only the three history routes, never the record itself.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ locale: { code: 'en', format_locale: 'en-US', timezone: 'UTC' } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ locale: 'en', t: (k: string) => k, tField: (_e: string, _f: string, fb?: string) => fb }),
}));

import { HistoryPanel } from '@/components/record/HistoryPanel';

const BASE = '/api/v1/resource/Customer/C-1';
const routes = vi.hoisted(() => ({ answers: {} as Record<string, { status: number; body: unknown }>, requests: [] as string[] }));

function ok(data: unknown) {
  return { status: 200, body: { success: true, status_code: 200, data, messages: [] } };
}

function meta(trackViews: boolean): EntityDefinition {
  return {
    name: 'Customer',
    module: 'm',
    database: 'd',
    naming: { strategy: 'system' },
    fields: [
      { fieldname: 'phone', fieldtype: 'Data', label: 'Phone' },
      { fieldname: 'city', fieldtype: 'Data', label: 'City' },
    ],
    permissions: [],
    ...(trackViews ? { track_views: true } : {}),
  } as unknown as EntityDefinition;
}

function renderPanel(trackViews: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HistoryPanel entity="Customer" name="C-1" meta={meta(trackViews)} />
    </QueryClientProvider>,
  );
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: /History/ }));
}

beforeEach(() => {
  routes.requests = [];
  routes.answers = {
    [`${BASE}/versions`]: ok([
      {
        _id: 'v1',
        changed_by: 'anna@example.com',
        timestamp: '2026-09-30T08:15:00.000Z',
        changes: [
          { field: 'phone', old: '1', new: '2' },
          { field: 'city', old: 'Bern', new: 'Basel' },
        ],
      },
    ]),
    ['/api/v1/activity/Customer/C-1']: ok([
      { _id: 'a1', action: 'Updated', user: 'ben@example.com', user_name: 'Ben Berg', creation: '2026-09-29T10:00:00.000Z' },
    ]),
    [`${BASE}/views`]: ok([{ viewed_by: 'cleo@example.com', timestamp: '2026-09-28T12:30:00.000Z' }]),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.split('?')[0]!;
      routes.requests.push(path);
      const answer = routes.answers[path];
      return answer
        ? new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('HistoryPanel', () => {
  it('reads nothing until it is opened', () => {
    renderPanel(true);
    expect(screen.getByRole('button', { name: /History/ })).toHaveAttribute('aria-expanded', 'false');
    expect(routes.requests).toEqual([]);
  });

  it('shows who saved each version, when, and which fields changed', async () => {
    renderPanel(true);
    await open();
    const versions = screen.getByTestId('record-history:versions');
    expect(await within(versions).findByText('anna@example.com')).toBeInTheDocument();
    expect(within(versions).getByText('09/30/2026, 08:15 AM')).toBeInTheDocument();
    expect(within(versions).getByText('Changed: Phone, City')).toBeInTheDocument();
  });

  it('shows the activity stream with the actor, the action and the time', async () => {
    renderPanel(true);
    await open();
    const activity = screen.getByTestId('record-history:activity');
    expect(await within(activity).findByText('Ben Berg')).toBeInTheDocument();
    expect(within(activity).getByText('Updated')).toBeInTheDocument();
    expect(within(activity).getByText('09/29/2026, 10:00 AM')).toBeInTheDocument();
  });

  it('shows who read the record for an entity with track_views', async () => {
    renderPanel(true);
    await open();
    const views = screen.getByTestId('record-history:views');
    expect(await within(views).findByText('cleo@example.com')).toBeInTheDocument();
    expect(within(views).getByText('09/28/2026, 12:30 PM')).toBeInTheDocument();
  });

  it('shows no views and asks no views route for an entity without track_views', async () => {
    renderPanel(false);
    await open();
    await within(screen.getByTestId('record-history:versions')).findByText('anna@example.com');
    expect(screen.queryByTestId('record-history:views')).not.toBeInTheDocument();
    expect(routes.requests).not.toContain(`${BASE}/views`);
  });

  it('reads only the history routes, never the record itself', async () => {
    renderPanel(true);
    await open();
    await within(screen.getByTestId('record-history:views')).findByText('cleo@example.com');
    expect([...routes.requests].sort()).toEqual(
      ['/api/v1/activity/Customer/C-1', `${BASE}/versions`, `${BASE}/views`].sort(),
    );
  });

  it('shows a failed read as an error and keeps the other parts', async () => {
    routes.answers[`${BASE}/versions`] = {
      status: 403,
      body: { success: false, status_code: 403, data: null, messages: [{ text: 'not_permitted', type: 'error' }] },
    };
    renderPanel(true);
    await open();
    const versions = screen.getByTestId('record-history:versions');
    expect(await within(versions).findByText('not_permitted')).toBeInTheDocument();
    expect(await within(screen.getByTestId('record-history:activity')).findByText('Ben Berg')).toBeInTheDocument();
  });

  it('says so when a part has nothing recorded', async () => {
    routes.answers['/api/v1/activity/Customer/C-1'] = ok([]);
    renderPanel(false);
    await open();
    expect(
      await within(screen.getByTestId('record-history:activity')).findByText('Nothing recorded yet'),
    ).toBeInTheDocument();
  });
});
