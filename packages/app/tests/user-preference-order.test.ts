// A person who clicks a preference's control twice quickly keeps the second choice on their
// account: each write looks up the person's row and creates it when there is none, so two writes
// that overlap would both create one, and the account refuses the second row of the key.
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The person's UserPreference rows, as the engine keeps them. */
let account: { _id: string; pref_key: string; value: unknown }[];
/** Whether the account refuses the next write once. */
let refuseNextWrite = false;
const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 20));

vi.mock('@/services/resource', () => ({
  getList: async (_entity: string, params: { filters: [string, string, string][] }) =>
    later({ success: true, data: account.filter((row) => row.pref_key === params.filters[0]![2]) }),
  createDoc: async (_entity: string, body: { pref_key: string; value: unknown }) => {
    if (refuseNextWrite) {
      refuseNextWrite = false;
      throw new Error('refused');
    }
    // The unique index on (owner, pref_key) refuses a second row of a key.
    if (account.some((row) => row.pref_key === body.pref_key)) throw new Error('DUPLICATE_ENTRY');
    account.push({ _id: `P-${account.length + 1}`, ...body });
    return later({ success: true, data: {} });
  },
  updateDoc: async (_entity: string, id: string, body: { value: unknown }) => {
    account.find((row) => row._id === id)!.value = body.value;
    return later({ success: true, data: {} });
  },
}));

const { setUserPreference } = await import('@/services/userPreference');

beforeEach(() => {
  account = [];
  refuseNextWrite = false;
});

describe('setUserPreference', () => {
  it('PLANTED DEFECT: keeps the second of two writes that do not wait for each other, on an account without the row', async () => {
    await Promise.all([setUserPreference('theme.mode', 'light'), setUserPreference('theme.mode', 'dark')]);
    expect(account).toEqual([{ _id: 'P-1', pref_key: 'theme.mode', value: 'dark' }]);
  });

  it('still rejects a write the account refuses, and runs the next one', async () => {
    refuseNextWrite = true;
    const refused = setUserPreference('theme.mode', 'light');
    const next = setUserPreference('theme.mode', 'dark');
    await expect(refused).rejects.toThrow('refused');
    await next;
    expect(account).toEqual([{ _id: 'P-1', pref_key: 'theme.mode', value: 'dark' }]);
  });
});
