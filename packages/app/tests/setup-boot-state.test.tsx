// @vitest-environment jsdom
// The app learns from /boot whether it is set up, and learns it again after every save of a
// settings record: that save is what completes the setup, on the setup page and on the record's
// own page alike, so the notice goes without a reload.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const getBootMock = vi.hoisted(() => vi.fn());
const updateDocMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/boot', () => ({ getBoot: getBootMock }));
vi.mock('@/services/resource', () => ({ updateDoc: updateDocMock }));

import { qk } from '@/lib/query-keys';
import { useSessionStore } from '@/stores/session';
import { useUpdate } from '@/hooks/useDocument';

const PENDING = { entity: 'WorkshopSetting', fields: ['street'], missing_record: false };
const NOT_SET_UP = { complete: false, records: [PENDING] };
const SET_UP = { complete: true, records: [] };

/** The answer of /boot for a demo session, whose preferences never roam, with `setup`. */
const bootAnswer = (setup: unknown) => ({
  success: true,
  data: {
    user: { _id: 'a', email: 'admin@digita.local', roles: ['Administrator'], demo: true },
    locale: { code: 'en' },
    available_languages: [],
    system_settings: { default_currency: null, allow_user_language: true, timezone: 'UTC' },
    setup,
  },
});

/** Save one record of an entity whose meta the app has loaded. */
async function saveRecordOf(meta: { name: string; is_single?: boolean }) {
  const qc = new QueryClient();
  qc.setQueryData(qk.meta(meta.name), meta);
  updateDocMock.mockResolvedValue({ success: true, data: { _id: 'x' } });
  const { result } = renderHook(() => useUpdate(meta.name), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  await result.current.mutateAsync({ name: 'x', body: {} });
}

beforeEach(() => {
  getBootMock.mockReset();
  useSessionStore.setState({ setup: null });
});

describe('the setup state of the session', () => {
  it('is what /boot answers at the start', async () => {
    getBootMock.mockResolvedValue(bootAnswer(NOT_SET_UP));
    await useSessionStore.getState().bootstrap();
    expect(useSessionStore.getState().setup).toEqual(NOT_SET_UP);
  });

  it('is read again after the save of a settings record', async () => {
    useSessionStore.setState({ setup: NOT_SET_UP });
    getBootMock.mockResolvedValue(bootAnswer(SET_UP));

    await saveRecordOf({ name: 'WorkshopSetting', is_single: true });

    await waitFor(() => expect(useSessionStore.getState().setup).toEqual(SET_UP));
  });

  it('is not read again after the save of any other record', async () => {
    useSessionStore.setState({ setup: NOT_SET_UP });

    await saveRecordOf({ name: 'Order' });

    expect(getBootMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().setup).toEqual(NOT_SET_UP);
  });
});
