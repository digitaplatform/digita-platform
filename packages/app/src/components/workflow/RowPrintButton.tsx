import { useParams } from 'react-router-dom';
import type { EntityReportLink } from '@digitaplatform/shared';
import { IconButton } from '@digitaplatform/components';
import { Printer } from 'lucide-react';
import { useI18nStore } from '@/stores/i18n';
import { useSessionStore } from '@/stores/session';
import { reportLinkLabel, reportLinkVisible } from '@/lib/report-link';
import { useChrome } from '@/lib/chrome-i18n';
import { tid } from '@/lib/testid';

type Doc = Record<string, unknown>;

/**
 * Per-row print affordance for the list page: a compact printer IconButton that
 * opens the page-level ReportPreviewDialog for THIS row's doc. The permission
 * gate (incl. the printModelled read-fallback) is evaluated once at page level;
 * here we only apply the link's per-row `show_if` — an affordance gate that fails
 * OPEN, with the report service staying the real security boundary.
 */
export function RowPrintButton({
  link,
  doc,
  onPrint,
}: {
  link: EntityReportLink;
  doc: Doc;
  onPrint: (doc: Doc) => void;
}) {
  // The list page takes its entity from the route, so the button keys the link's label by it too.
  const { entity } = useParams<{ entity: string }>();
  const translations = useI18nStore((s) => s.translations);
  const tc = useChrome();
  const user = useSessionStore((s) => s.user);
  if (!reportLinkVisible(link, doc, user)) return null;
  const label = entity ? reportLinkLabel(entity, link, translations) : link.label;
  return (
    <IconButton
      size="sm"
      variant="ghost"
      label={label ?? tc('ui.action.print')}
      icon={<Printer className="h-4 w-4" aria-hidden="true" />}
      onClick={(e) => {
        e.stopPropagation();
        onPrint(doc);
      }}
      {...tid.action('print')}
    />
  );
}
