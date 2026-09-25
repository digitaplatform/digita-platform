import type { EntityReportLink } from '@digitaplatform/shared';
import { IconButton } from '@digitaplatform/components';
import { Printer } from 'lucide-react';
import { reportLinkVisible } from '@/lib/report-link';
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
  if (!reportLinkVisible(link, doc)) return null;
  return (
    <IconButton
      size="sm"
      variant="ghost"
      label={link.label ?? 'Print'}
      icon={<Printer className="h-4 w-4" aria-hidden="true" />}
      onClick={(e) => {
        e.stopPropagation();
        onPrint(doc);
      }}
      {...tid.action('print')}
    />
  );
}
