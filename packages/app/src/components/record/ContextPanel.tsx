import { useEffect, useRef, useState } from 'react';
import type { EntityDefinition, FieldDefinition, ViewResult, ViewSectionData } from '@digitaplatform/shared';
import { Card, ErrorBlock, Spinner, cn, tableSkin } from '@digitaplatform/components';
import { getView } from '@/services/resource';
import { useI18nStore } from '@/stores/i18n';

type Doc = Record<string, unknown>;

/**
 * Metadata-driven record context: for every Link field that declares a
 * `context_view` AND carries a value, render one collapsible section fed by
 * that declarative View (`id` param = the picked record id). Pure platform
 * code — WHICH context exists is app metadata (e.g. customer → customer360
 * with credit exposure / open items / recent orders). Sections re-fetch when
 * the picked value changes; a failed view renders a compact alert, never
 * breaks the form.
 */
export function ContextPanel({
  entity,
  meta,
  doc,
}: {
  entity: string;
  meta: EntityDefinition;
  doc: Doc;
}) {
  const contextFields = meta.fields.filter(
    (f) => f.fieldtype === 'Link' && f.context_view && doc[f.fieldname] != null && doc[f.fieldname] !== '',
  );
  if (contextFields.length === 0) return null;

  return (
    <aside className="flex min-w-0 flex-col gap-4" data-testid="context-panel">
      {contextFields.map((f) => (
        <FieldContext
          key={f.fieldname}
          entity={entity}
          field={f}
          value={String(doc[f.fieldname])}
        />
      ))}
    </aside>
  );
}

function FieldContext({
  entity,
  field,
  value,
}: {
  entity: string;
  field: FieldDefinition;
  value: string;
}) {
  const tField = useI18nStore((s) => s.tField);
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState<ViewResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const ticketRef = useRef(0);

  useEffect(() => {
    const ticket = ++ticketRef.current;
    setStatus('loading');
    getView(field.context_view!, { id: value })
      .then((res) => {
        if (ticket !== ticketRef.current) return; // superseded by a newer pick
        if (!res.success || !res.data) {
          setStatus('error');
          return;
        }
        setResult(res.data as ViewResult);
        setStatus('ready');
      })
      .catch(() => {
        if (ticket === ticketRef.current) setStatus('error');
      });
  }, [field.context_view, value]);

  const title = field.context_title ?? tField(entity, field.fieldname, field.label);

  return (
    <Card className="p-0" data-testid={`context-panel:${field.fieldname}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-textMain hover:bg-bgHover"
      >
        <span className="truncate">{title}</span>
        <span aria-hidden="true" className={cn('transition-transform duration-base', open ? 'rotate-90' : '')}>
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          {status === 'loading' && <Spinner />}
          {status === 'error' && <ErrorBlock title={String(title)} />}
          {status === 'ready' &&
            result &&
            Object.entries(result.sections).map(([key, data]) => (
              <Section key={key} name={key} data={data} />
            ))}
        </div>
      )}
    </Card>
  );
}

/** Generic section rendering: one object → key/value rows; an array → a mini
 *  table of the first columns; null/empty → skipped entirely. */
function Section({ name, data }: { name: string; data: ViewSectionData }) {
  if (data == null || (Array.isArray(data) && data.length === 0)) return null;

  if (Array.isArray(data)) {
    const cols = Object.keys(data[0] ?? {}).slice(0, 3);
    return (
      <div className="min-w-0">
        <div className={cn('mb-1 text-textMuted', tableSkin.headerCell)}>{name}</div>
        <table className="w-full text-xs">
          <tbody>
            {data.slice(0, 5).map((row, i) => (
              <tr key={i} className={cn(tableSkin.row, 'last:border-b-0')}>
                {cols.map((c) => (
                  <td key={c} className="max-w-0 truncate py-1 pr-2 text-textMain tabular-nums">
                    {formatValue(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const entries = Object.entries(data).filter(([, v]) => v != null && typeof v !== 'object');
  if (entries.length === 0) return null;
  return (
    <div className="min-w-0">
      <div className={cn('mb-1 text-textMuted', tableSkin.headerCell)}>{name}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-textMuted">{k}</dt>
            <dd className="truncate text-right text-textMain tabular-nums">{formatValue(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-textMuted">
      <path d="M7 6l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
