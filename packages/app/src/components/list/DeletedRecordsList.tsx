import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, cn, EmptyState, tableSkin } from '@digitaplatform/components';
import { restoreDoc } from '@/services/resource';
import { unwrap } from '@/lib/api-result';
import { qkPrefix } from '@/lib/query-keys';
import { formatDatetime } from '@/lib/format';
import { useSessionStore } from '@/stores/session';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useChrome } from '@/lib/chrome-i18n';
import { tid } from '@/lib/testid';

/** The normal resource list's marked rows, with a restore action for each. */
export function DeletedRecordsList({ entity, rows, titleField, page, total, totalPages, onPageChange }: { entity: string; rows: Record<string, unknown>[]; titleField?: string; page: number; total: number; totalPages: number; onPageChange: (page: number) => void }) {
  const tc = useChrome();
  const dialog = useDialogHost();
  const queryClient = useQueryClient();
  const locale = useSessionStore((s) => s.locale);
  const restore = useMutation({
    mutationFn: async (name: string) => unwrap(await restoreDoc(entity, name)),
    onSuccess: (_row, name) => dialog.toast(tc('ui.list.restored', { name }), 'success'),
    onError: (error) => dialog.toast(error instanceof Error ? error.message : tc('ui.list.restoreFailed'), 'error'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qkPrefix.entity(entity) }),
  });

  if (total === 0) return <EmptyState testId="deleted-empty" title={tc('ui.list.noDeleted')} />;
  return (
    <div className="space-y-3">
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
            const name = String(row['_id']);
            const title = titleField ? row[titleField] : undefined;
            return (
              <tr key={name} className={tableSkin.row} {...tid.row(entity, name)}>
                <td className="px-3 py-2 text-textMain">
                  {typeof title === 'string' ? title : name}
                  {typeof title === 'string' && title && <span className="ml-2 text-caption text-textMuted">{name}</span>}
                </td>
                <td className="px-3 py-2 tabular-nums text-textMuted">
                  {formatDatetime(String(row['deleted']), locale?.format_locale, locale?.timezone)}
                </td>
                <td className="px-3 py-2 text-textMuted">{String(row['deleted_by'] ?? '')}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="secondary" disabled={restore.isPending} onClick={() => restore.mutate(name)} {...tid.action(`restore-${name}`)}>
                    {tc('ui.action.restore')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-textMuted">
        <span>{tc('ui.list.summary', { total, page, pages: Math.max(totalPages, 1) })}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>{tc('ui.list.previous')}</Button>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>{tc('ui.list.next')}</Button>
        </div>
      </div>
    </div>
  );
}
