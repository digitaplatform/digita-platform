// @vitest-environment jsdom
// A person's own preference is read and written on their own row, for an Administrator too: the
// engine lets an Administrator list every person's rows, so a read on the key alone returned the
// first person's row and a write changed it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { _id: string; owner: string; pref_key: string; value: unknown };
let rows: Row[] = [];

// The engine as an Administrator sees it: every row, narrowed only by the filters sent.
vi.mock('@/services/resource', () => ({
  getList: async (_entity: string, params: { filters?: [string, string, unknown][]; page_size?: number }) => {
    const matching = rows.filter((row) =>
      (params.filters ?? []).every(([field, op, value]) => op === '=' && row[field as keyof Row] === value),
    );
    return { success: true, data: matching.slice(0, params.page_size ?? 20) };
  },
  updateDoc: vi.fn(async (_entity: string, id: string, body: { value: unknown }) => {
    rows = rows.map((row) => (row._id === id ? { ...row, ...body } : row));
  }),
  createDoc: vi.fn(async (_entity: string, body: { pref_key: string; value: unknown }) => {
    rows.push({ _id: `new-${rows.length}`, owner: 'admin@demo.test', ...body });
  }),
}));

const { getUserPreference, setUserPreference } = await import('@/services/userPreference');
const { useSessionStore } = await import('@/stores/session');

beforeEach(() => {
  rows = [{ _id: 'other-1', owner: 'clerk@demo.test', pref_key: 'ui.density', value: 'compact' }];
  useSessionStore.setState({ user: { _id: 'u1', email: 'admin@demo.test', roles: ['Administrator'] } });
});

describe("an Administrator's own preference", () => {
  it("reads nothing where only another person's row exists", async () => {
    expect(await getUserPreference('ui.density')).toBeUndefined();
  });

  it("creates their own row and leaves the other person's row as it was", async () => {
    await setUserPreference('ui.density', 'comfortable');
    expect(rows.find((row) => row._id === 'other-1')?.value).toBe('compact');
    expect(rows.find((row) => row.owner === 'admin@demo.test')?.value).toBe('comfortable');
    expect(await getUserPreference('ui.density')).toBe('comfortable');
  });

  it('updates their own row once it exists', async () => {
    rows.push({ _id: 'admin-1', owner: 'admin@demo.test', pref_key: 'ui.density', value: 'comfortable' });
    await setUserPreference('ui.density', 'compact');
    expect(rows.find((row) => row._id === 'admin-1')?.value).toBe('compact');
    expect(rows).toHaveLength(2);
  });

  it('refuses a read or a write without a signed-in person', async () => {
    useSessionStore.setState({ user: null });
    await expect(getUserPreference('ui.density')).rejects.toThrow();
    await expect(setUserPreference('ui.density', 'compact')).rejects.toThrow();
  });
});
