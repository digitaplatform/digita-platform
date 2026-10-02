import { describe, expect, it } from 'vitest';
import { toApiError } from '@/lib/errors';

// An engine error answers its code as error.detail and the person's text, in their language, as
// the first error message; a page shows the error's message, so it must be that text.
const refusal = (status: number, code: string, detail: string, text: string) => ({
  success: false,
  status_code: status,
  data: null,
  messages: [{ text, type: 'error', show: true }],
  error: { code, detail, trace_id: 'trace-1' },
});

describe('toApiError', () => {
  it('reads the text of a missing document and of a refused action, never the code', () => {
    const missing = toApiError(404, refusal(404, 'NOT_FOUND', 'not_found', 'Item NOPE-1 nicht gefunden'));
    const refused = toApiError(
      403,
      refusal(403, 'PERMISSION_DENIED', 'permission_denied_select', 'Du hast keine Berechtigung, Item aufzulisten oder zu durchsuchen'),
    );

    expect([missing.message, missing.status, missing.code]).toEqual(['Item NOPE-1 nicht gefunden', 404, 'NOT_FOUND']);
    expect(refused.message).toBe('Du hast keine Berechtigung, Item aufzulisten oder zu durchsuchen');
  });

  it("PLANTED DEFECT: keeps the server's text for the person as the reason, and no reason where it sent none", () => {
    expect(toApiError(404, refusal(404, 'NOT_FOUND', 'not_found', 'Item NOPE-1 nicht gefunden')).reason).toBe('Item NOPE-1 nicht gefunden');
    expect(toApiError(500, { ...refusal(500, 'INTERNAL_ERROR', 'An unexpected error occurred', ''), messages: [] }).reason).toBeUndefined();
    expect(toApiError(403, { error: 'demo_session_forbidden', message: 'Nicht in der Demo' }).reason).toBe('Nicht in der Demo');
    // A service's translator answers a code it has no text for with the code itself.
    expect(toApiError(400, { error: 'demo_session_required', message: 'demo_session_required' }).reason).toBeUndefined();
    expect(toApiError(400, { error: 'demo_session_required' }).reason).toBeUndefined();
  });

  it('falls back to the detail, then to the status, when the answer carries no error message', () => {
    expect(toApiError(500, { ...refusal(500, 'INTERNAL_ERROR', 'An unexpected error occurred', ''), messages: [] }).message).toBe(
      'An unexpected error occurred',
    );
    expect(toApiError(502, { success: false, messages: [] }).message).toBe('Request failed with status 502');
  });
});
