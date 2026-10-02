import { Navigate } from 'react-router-dom';
import { FormSkeleton, PageHeader } from '@digitaplatform/components';
import { useMeta } from '@/hooks/useMeta';
import { useSingle } from '@/hooks/useDocument';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { ErrorBlock } from '@/components/status';
import { RecordSkeleton } from '@/components/render/RecordSkeleton';
import { RecordForm } from '@/pages/RecordPage';

type Doc = Record<string, unknown>;

/**
 * `/_setup`: the settings an app cannot work without. The engine names each settings record its
 * own save would refuse, with the fields that are open, to a user who may write it; this page
 * asks for exactly those fields in that record's own form, one record at a time. The session
 * re-reads the setup state after the save, and the page follows it: the next record, or the
 * start page once nothing is open. A user who can fill nothing is sent to the start page.
 */
export default function SetupPage() {
  const record = useSessionStore((s) => s.setup?.records[0]);
  const metaQ = useMeta(record?.entity);
  const singleQ = useSingle<Doc>(record && !record.missing_record ? record.entity : undefined);
  const tc = useChrome();
  const tEntity = useI18nStore((s) => s.tEntity);

  if (!record) return <Navigate to="/" replace />;
  if (metaQ.isLoading) return <FormSkeleton fields={8} />;
  if (metaQ.isError || !metaQ.data) {
    return <ErrorBlock title={tc('ui.entity.notFound')} detail={record.entity} />;
  }
  const meta = metaQ.data;
  const label = tEntity(record.entity, meta.label ?? record.entity);

  return (
    <div className="space-y-4">
      {/* Pulled out by the header's own inset so its title lines up with the form, as on a record. */}
      <PageHeader className="-mx-4" eyebrow={label} title={tc('ui.setup.title')} />
      {record.missing_record ? (
        <p role="alert" className="rounded-lg border border-warning bg-warning-light px-4 py-3 text-sm text-textMain">
          {tc('ui.setup.recordMissing', { entity: label })}
        </p>
      ) : singleQ.isLoading ? (
        <RecordSkeleton meta={meta} />
      ) : singleQ.isError || !singleQ.data ? (
        <ErrorBlock
          title={tc('ui.record.loadFailed')}
          detail={singleQ.error instanceof Error ? singleQ.error.message : record.entity}
        />
      ) : (
        <>
          <p className="text-sm text-textMuted">{tc('ui.setup.intro')}</p>
          <RecordForm
            // A form of its own for each record, as each record page has.
            key={record.entity}
            entity={record.entity}
            meta={meta}
            initial={singleQ.data}
            isNew={false}
            isSingle
            name={singleQ.data['_id'] as string}
            setupFields={record.fields}
          />
        </>
      )}
    </div>
  );
}
