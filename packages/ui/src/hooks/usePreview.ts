import { useCallback, useEffect, useRef, useState } from 'react';
import { previewDoc } from '@/services/resource';
import { unwrap } from '@/lib/api-result';

type Doc = Record<string, unknown>;

export interface PreviewState<T> {
  data: T | null;
  status: 'idle' | 'loading' | 'error';
}

/**
 * Debounced compute-preview. NOT a query: the form calls `trigger(draft)` on
 * meaningful changes; the engine runs the computed hooks (no persist) and returns
 * the resolved doc. Single-flight via a monotonically increasing ticket — a late,
 * superseded response can never overwrite newer state. Gated by `enabled` (the
 * Page only enables it for entities that actually have computed line-item totals).
 *
 * NOTE: true request cancellation (AbortController) needs the api client to accept
 * a signal — the ticket guard already makes stale responses inert; abort is a
 * future micro-optimization, not a correctness requirement.
 */
export function usePreview<T = Doc>(
  entity: string,
  opts?: { enabled?: boolean; debounceMs?: number },
) {
  const enabled = opts?.enabled ?? true;
  const debounceMs = opts?.debounceMs ?? 350;
  const [state, setState] = useState<PreviewState<T>>({ data: null, status: 'idle' });
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(
    (draft: Doc) => {
      if (!enabled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const ticket = ++seqRef.current;
        setState((s) => ({ ...s, status: 'loading' }));
        previewDoc<T>(entity, draft)
          .then((res) => {
            if (ticket !== seqRef.current) return; // superseded
            setState({ data: unwrap(res), status: 'idle' });
          })
          .catch(() => {
            if (ticket !== seqRef.current) return;
            setState({ data: null, status: 'error' });
          });
      }, debounceMs);
    },
    [entity, enabled, debounceMs],
  );

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    seqRef.current++; // invalidate any in-flight response
  }, []);

  // Drop a pending debounce on unmount.
  useEffect(() => () => cancel(), [cancel]);

  return { data: state.data, status: state.status, trigger, cancel };
}
