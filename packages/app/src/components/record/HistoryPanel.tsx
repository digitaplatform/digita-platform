import { useState, type ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';
import { Card, Spinner, cn } from '@digitaplatform/components';
import { getActivity, getVersions, getViews } from '@/services/resource';
import { qk } from '@/lib/query-keys';
import { toUiMessages, unwrap } from '@/lib/api-result';
import { formatDatetime } from '@/lib/format';
import { useChrome } from '@/lib/chrome-i18n';
import { useI18nStore } from '@/stores/i18n';
import { useSessionStore } from '@/stores/session';
import { ErrorBlock } from '@/components/status';
import { tid } from '@/lib/testid';

/** The actions of a document's activity stream that have a text; any other shows as the engine names it. */
const DOC_ACTIONS = new Set(['Created', 'Updated', 'Submitted', 'Cancelled', 'Deleted', 'Restored', 'Amended', 'Shared']);

/**
 * A saved record's history: its versions (who, when, which fields), its activity stream and,
 * for an entity with `track_views`, who read it. The panel starts closed and reads the routes
 * only once opened, and it never reads the record itself, so opening a record costs no history
 * reads and the history adds no read of the record.
 */
export function HistoryPanel({ entity, name, meta }: { entity: string; name: string; meta: EntityDefinition }) {
  const tc = useChrome();
  const [open, setOpen] = useState(false);

  return (
    <Card className="p-0" {...tid.component('record-history', entity)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-textMain hover:bg-bgHover"
      >
        <span>{tc('ui.record.history.title')}</span>
        <span aria-hidden="true" className={cn('transition-transform duration-base', open ? 'rotate-90' : '')}>
          ›
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-3 text-sm">
          <Versions entity={entity} name={name} meta={meta} />
          <Activity entity={entity} name={name} />
          {meta.track_views && <Views entity={entity} name={name} />}
        </div>
      )}
    </Card>
  );
}

function Versions({ entity, name, meta }: { entity: string; name: string; meta: EntityDefinition }) {
  const tc = useChrome();
  const tField = useI18nStore((s) => s.tField);
  const when = useWhen();
  const q = useQuery({
    queryKey: qk.versions(entity, name),
    queryFn: async () => unwrap(await getVersions(entity, name)),
  });
  const label = (field: string) => tField(entity, field, meta.fields.find((f) => f.fieldname === field)?.label ?? field);
  return (
    <Section title={tc('ui.record.history.versions')} query={q} part="versions">
      {q.data?.map((v, i) => (
        <li key={v._id ?? i}>
          <Line who={v.changed_by} when={when(v.timestamp)} />
          <div className="text-textMuted">
            {v.changes.length > 0
              ? tc('ui.record.history.changed', { fields: v.changes.map((c) => label(c.field)).join(', ') })
              : tc('ui.record.history.noReadableChange')}
          </div>
        </li>
      ))}
    </Section>
  );
}

function Activity({ entity, name }: { entity: string; name: string }) {
  const tc = useChrome();
  const when = useWhen();
  const q = useQuery({
    queryKey: qk.activity(entity, name),
    queryFn: async () => unwrap(await getActivity(entity, name)),
  });
  return (
    <Section title={tc('ui.record.history.activity')} query={q} part="activity">
      {q.data?.map((a) => (
        <li key={a._id}>
          <Line who={a.user_name || a.user} when={when(a.creation)} />
          <div className="text-textMuted">
            {DOC_ACTIONS.has(a.action) ? tc(`ui.record.history.action.${a.action}`) : a.action}
            {a.summary ? ` · ${a.summary}` : ''}
          </div>
        </li>
      ))}
    </Section>
  );
}

function Views({ entity, name }: { entity: string; name: string }) {
  const tc = useChrome();
  const when = useWhen();
  const q = useQuery({
    queryKey: qk.views(entity, name),
    queryFn: async () => unwrap(await getViews(entity, name)),
  });
  return (
    <Section title={tc('ui.record.history.views')} query={q} part="views">
      {q.data?.map((v, i) => (
        <li key={i}>
          <Line who={v.viewed_by} when={when(v.timestamp)} />
        </li>
      ))}
    </Section>
  );
}

function Section({
  title,
  query,
  part,
  children,
}: {
  title: string;
  query: UseQueryResult<unknown[]>;
  part: string;
  children: ReactNode;
}) {
  const tc = useChrome();
  const t = useI18nStore((s) => s.t);
  return (
    <section className="min-w-0" data-testid={`record-history:${part}`}>
      <h3 className="mb-1 font-semibold text-textMain">{title}</h3>
      {query.isPending && <Spinner />}
      {query.isError && <ErrorBlock title={title} detail={toUiMessages(query.error, t)[0]?.text} />}
      {query.isSuccess &&
        (query.data.length === 0 ? (
          <p className="text-textMuted">{tc('ui.record.history.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">{children}</ul>
        ))}
    </section>
  );
}

function Line({ who, when }: { who: string; when: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <span className="font-medium text-textMain">{who}</span>
      <span className="text-textMuted tabular-nums">{when}</span>
    </div>
  );
}

function useWhen() {
  const locale = useSessionStore((s) => s.locale);
  return (value: string) => formatDatetime(value, locale?.format_locale, locale?.timezone);
}
