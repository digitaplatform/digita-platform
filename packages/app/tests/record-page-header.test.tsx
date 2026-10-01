// @vitest-environment jsdom
// The record page pins the form's tab strip under the header's bar, leads back to its list
// from the bar and keeps the record's actions under the title.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Ref } from 'react';
import type { EntityDefinition } from '@digitaplatform/shared';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Invoice', name: 'INV-1' }),
  useNavigate: () => navigate,
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({
    data: { _id: 'INV-1', modified: 'T1', docstatus: 0, note: 'a', scan: '/api/v1/file/FILE-1/download' },
    isLoading: false,
    isError: false,
  }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/render/FormRenderer', () => ({
  FormRenderer: ({ tabsClassName, tabsRef }: { tabsClassName?: string; tabsRef?: Ref<HTMLDivElement> }) => (
    <div role="tablist" ref={tabsRef} className={tabsClassName} />
  ),
}));
vi.mock('@/components/workflow/PrintMenu', () => ({
  PrintMenu: () => <button type="button">Print</button>,
}));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) => sel({ user: { roles: ['Administrator'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: { t: (k: string) => string; tEntity: (e: string, fb?: string) => string }) => unknown) =>
    sel({ t: (k: string) => k, tEntity: (e: string, fb?: string) => fb ?? e }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

const META = {
  name: 'Invoice',
  label: 'Invoice',
  label_plural: 'Invoices',
  title_field: '_id',
  fields: [
    { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
    { fieldname: 'scan', fieldtype: 'AttachImage', label: 'Scan' },
  ],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;
let meta = META;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <div data-testid="scroller" style={{ overflowY: 'auto', height: '200px' }}>
        <RecordPage />
      </div>
    </QueryClientProvider>,
  );
}

describe('RecordPage header', () => {
  it('pins the tab strip under the bar, by the height the header publishes', () => {
    renderPage();
    expect(screen.getByRole('tablist').className).toContain(
      'sticky top-[calc(var(--topbar-h,0px)_+_var(--page-header-bar-h,0px))]',
    );
  });

  it('publishes the pinned strip\'s height on the scroll container, so the scroll padding reads it', () => {
    // jsdom lays nothing out: the height comes from the stub. This proves the variable, not
    // that a focused field lands below the strip; the built CSS is measured in a browser.
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute('role') === 'tablist' ? 39 : 0;
      },
    });
    try {
      const { unmount } = renderPage();
      const scroller = screen.getByTestId('scroller');
      expect(scroller.style.getPropertyValue('--form-tabs-h')).toBe('39px');
      unmount();
      expect(scroller.style.getPropertyValue('--form-tabs-h')).toBe('');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
    }
  });

  it('leads back to the list, named as the list names itself', () => {
    renderPage();
    const back = screen.getByRole('button', { name: 'Invoices' });
    expect(document.querySelector('[data-ui="page-header-bar"]')).toContainElement(back);
    fireEvent.click(back);
    expect(navigate).toHaveBeenCalledWith('/Invoice');
  });

  it('draws the actions under the title, not in the bar', () => {
    renderPage();
    const print = screen.getByRole('button', { name: 'Print' });
    expect(document.querySelector('[data-ui="page-header-bar"]')).not.toContainElement(print);
    expect(document.querySelector('form')).toContainElement(print);
  });

  it('draws the picture image_field names before the title, as its thumbnail', () => {
    meta = { ...META, image_field: 'scan' } as EntityDefinition;
    try {
      renderPage();
      const media = document.querySelector('[data-ui="page-header-media"]');
      const img = media?.querySelector('img');
      expect(img).toHaveAttribute('src', '/api/v1/file/FILE-1/download?thumb=1');
      expect(document.querySelector('[data-ui="page-header-bar"]')).not.toContainElement(img as HTMLElement);
    } finally {
      meta = META;
    }
  });

  it('draws no picture for an entity that names no image_field, though a record has an image', () => {
    renderPage();
    expect(document.querySelector('[data-ui="page-header-media"]')).toBeNull();
    expect(document.querySelector('[data-component="record-image"]')).toBeNull();
  });
});
