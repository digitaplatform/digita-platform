import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, cn, EmptyState, TableSkeleton, tableSkin } from '@digitaplatform/components';
import { listDeleted, restoreDeleted } from '@/services/resource';
import { unwrap } from '@/lib/api-result';
import { qk, qkPrefix } from '@/lib/query-keys';
import { formatDatetime } from '@/lib/format';
import { useSessionStore } from '@/stores/session';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useChrome } from '@/lib/chrome-i18n';
import { ErrorBlock } from '@/components/status';
import { tid } from '@/lib/testid';

/**
 * The entity's deleted records the person may restore, the latest first, each with when and by
 * whom it was deleted. A record deleted twice is listed twice. Restore puts the chosen deletion back
 * under its id; the engine refuses it where a new record took the id or a unique value meanwhile.
 */
export function DeletedRecordsList({ entity }: { entity: string }) {
  const tc = useChrome();
  const dialog = useDialogHost();
  const queryClient = useQueryClient();
  const locale = useSessionStore((s) => s.locale);
  const deletedQ = useQuery({ queryKey: qk.deleted(entity), queryFn: async () => unwrap(await listDeleted(entity)) });

  const restore = async (name: string, deletedAt: string) => {
    try {
      unwrap(await restoreDeleted(entity, name, deletedAt));
      dialog.toast(tc('ui.list.restored', { name }), 'success');
    } catch (e) {
      dialog.toast(e instanceof Error ? e.message : tc('ui.list.restoreFailed'), 'error');
    }
    await queryClient.invalidateQueries({ queryKey: qkPrefix.entity(entity) });
  };

  if (deletedQ.isLoading) return <TableSkeleton columns={4} rows={5} />;
  if (deletedQ.isError) {
    return (
      <ErrorBlock
        title={tc('ui.list.loadFailed')}
        detail={deletedQ.error instanceof Error ? deletedQ.error.message : tc('ui.status.somethingWrong')}
      />
    );
  }
  const rows = deletedQ.data ?? [];
  if (rows.length === 0) return <EmptyState testId="deleted-empty" title={tc('ui.list.noDeleted')} />;
  return (
    <div className={cn('overflow-x-auto', tableSkin.frame)}>
      <table className="w-full text-sm">
        <thead className={tableSkin.header}>
          <tr>
            <th className={cn(tableSkin.headerCell, 'px-3 py-2 text-left')}>{tc('ui.list.deletedRecord')}</th>
            <th className={cn(tableSkin.headerCell, 'px-3 py-2 text-left')}>{tc('ui.list.deletedAt')}</th>
            <th className={cn(tableSkin.headerCell, 'px-3 py-2 text-left')}>{tc('ui.list.deletedBy')}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const deletion = `${row.name}@${row.deleted_at}`;
            return (
              <tr key={deletion} className={tableSkin.row} {...tid.row(entity, deletion)}>
                <td className="px-3 py-2 text-textMain">
                  {row.title ?? row.name}
                  {row.title && <span className="ml-2 text-caption text-textMuted">{row.name}</span>}
                </td>
                <td className="px-3 py-2 tabular-nums text-textMuted">
                  {formatDatetime(row.deleted_at, locale?.format_locale, locale?.timezone)}
                </td>
                <td className="px-3 py-2 text-textMuted">{row.deleted_by}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="secondary" onClick={() => void restore(row.name, row.deleted_at)} {...tid.action(`restore-${deletion}`)}>
                    {tc('ui.action.restore')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
