import { useEffect, useRef, useState } from 'react';
import type { ViewResult } from '@digitaplatform/shared';
import { getView } from '@/services/resource';

type Doc = Record<string, unknown>;

/**
 * Compact line context under an entry_flow grid — contextual read-only info
 * for the line being entered (e.g. availability / last price / valuation),
 * fed by a declarative View
 * (`entry_context_view`). The param mapping comes from metadata
 * (`entry_context_params`): view param → row field, or `$doc.<field>` for the
 * parent document (same token semantics as target_filters). The FIRST mapped
 * param acts as the required anchor (no fetch while it is empty); empty
 * optionals are omitted from the query. Debounced + ticket-guarded so rapid
 * entry never races a stale response over a fresh one.
 */
export function EntryContextBar({
  view,
  paramsMap,
  row,
  doc,
}: {
  view: string;
  paramsMap: Record<string, string>;
  row: Doc;
  doc: Doc;
}) {
  const [result, setResult] = useState<ViewResult | null>(null);
  const ticketRef = useRef(0);

  // Resolve the mapping against the current row/doc.
  const entries = Object.entries(paramsMap);
  const resolved: Record<string, string> = {};
  for (const [param, source] of entries) {
    const raw = source.startsWith('$doc.') ? doc[source.slice(5)] : row[source];
    if (raw != null && raw !== '') resolved[param] = String(raw);
  }
  const anchorParam = entries[0]?.[0];
  const anchored = anchorParam ? resolved[anchorParam] != null : false;
  const key = JSON.stringify(resolved);

  useEffect(() => {
    if (!anchored) {
      setResult(null);
      return;
    }
    const ticket = ++ticketRef.current;
    const t = setTimeout(() => {
      getView(view, JSON.parse(key) as Record<string, string>)
        .then((res) => {
          if (ticket !== ticketRef.current) return;
          setResult(res.success && res.data ? (res.data as ViewResult) : null);
        })
        .catch(() => {
          if (ticket === ticketRef.current) setResult(null);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [view, key, anchored]);

  if (!anchored || !result) return null;

  // Flatten every section into label:value pairs (aggregate rows and the
  // first row of lists alike) — the strip is a one-liner by design.
  const pairs: Array<[string, string]> = [];
  for (const [, data] of Object.entries(result.sections)) {
    const rowData = Array.isArray(data) ? data[0] : data;
    if (!rowData) continue;
    for (const [k, v] of Object.entries(rowData)) {
      if (v == null || typeof v === 'object') continue;
      pairs.push([k, typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v)]);
    }
  }
  if (pairs.length === 0) return null;

  return (
    <div
      data-testid="entry-context-bar"
      className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-border bg-subtle px-3 py-1.5 text-xs text-textMuted"
    >
      {pairs.map(([k, v]) => (
        <span key={k} className="whitespace-nowrap">
          {k}: <span className="font-medium text-textMain tabular-nums">{v}</span>
        </span>
      ))}
    </div>
  );
}
