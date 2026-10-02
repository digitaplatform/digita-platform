// @vitest-environment jsdom
// While an app is not set up, the engine refuses every new record. The app's frame says so on every
// page, so nobody fills a form in vain: a user who may complete the setup gets the way to its
// page, everyone else is told whom to ask.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
// The frame around the notice, reduced to its main region as in shell-scroll-padding.test.tsx.
vi.mock('@/templates/template-registry', () => ({
  resolveTemplate: () => ({ id: 'classic', version: 1, regions: [{ id: 'main', side: 'main' }] }),
}));
vi.mock('@/components/layout/Topbar', () => ({ Topbar: () => <div>topbar</div> }));
vi.mock('@/components/command/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeConnection: () => {} }));
vi.mock('@/plugins/registry', () => ({ Region: () => null }));

import { useSessionStore } from '@/stores/session';
import { SetupNotice } from '@/components/layout/SetupNotice';
import { ShellRenderer } from '@/templates/ShellRenderer';

const PENDING = { entity: 'WorkshopSetting', fields: ['street'], missing_record: false };

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SetupNotice />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('the notice of an app that is not set up', () => {
  it('leads a user who may complete the setup to its page', () => {
    useSessionStore.setState({ setup: { complete: false, records: [PENDING] } });
    renderAt('/Order');

    expect(screen.getByRole('status')).toHaveTextContent('ui.setup.notice');
    expect(screen.getByRole('link', { name: 'ui.setup.title' })).toHaveAttribute('href', '/_setup');
    expect(screen.getByRole('status')).not.toHaveTextContent('ui.setup.askAdministrator');
  });

  it('tells everyone else whom to ask', () => {
    useSessionStore.setState({ setup: { complete: false, records: [] } });
    renderAt('/Order');

    expect(screen.getByRole('status')).toHaveTextContent('ui.setup.notice');
    expect(screen.getByRole('status')).toHaveTextContent('ui.setup.askAdministrator');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('is absent on the setup page, which says it itself', () => {
    useSessionStore.setState({ setup: { complete: false, records: [PENDING] } });
    renderAt('/_setup');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['the setup is complete', { complete: true, records: [] }],
    ['the engine told nothing about the setup', null],
  ])('is absent where %s', (_case, setup) => {
    useSessionStore.setState({ setup });
    renderAt('/Order');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('the frame of the app', () => {
  it('shows the notice in its main region, on whatever page is open', () => {
    useSessionStore.setState({ setup: { complete: false, records: [] } });
    render(
      <MemoryRouter initialEntries={['/Order']}>
        <ShellRenderer />
      </MemoryRouter>,
    );

    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent('ui.setup.notice');
  });
});
