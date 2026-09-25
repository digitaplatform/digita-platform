import { useEffect, useRef, useState } from 'react';
import type { EntityDefinition, EntityReportLink } from '@digitaplatform/shared';
import { Button, ReportPreviewDialog } from '@digitaplatform/components';
import { ChevronDown, Printer } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { hasEntityPermission, type PermAction } from '@/lib/permissions';
import { reportLinkVisible, reportRenderUrl, resolveReportParams } from '@/lib/report-link';
import { useChrome } from '@/lib/chrome-i18n';
import { tid } from '@/lib/testid';

type Doc = Record<string, unknown>;

/**
 * Metadata-driven print buttons: entity.reports links a digita-report
 * definition to this entity; clicking opens the embedded preview (iframe
 * onto the report service — frame-ancestors + SSO cookie make it work),
 * with print (?print=1 self-print tab) and per-format downloads.
 */
export function PrintMenu({ meta, doc }: { meta: EntityDefinition; doc: Doc }) {
  const user = useSessionStore((s) => s.user);
  const tc = useChrome();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<EntityReportLink | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  // Affordance gate only — the report service enforces its own roles
  // server-side. Legacy entities never SET the print flag on any permission
  // row; for those, "may read" implies "may print" (otherwise the buttons
  // would be invisible to everyone but the literal Administrator role).
  const printModelled = (meta.permissions ?? []).some((p) => p.print !== undefined);
  const links = (meta.reports ?? []).filter((link) => {
    const required = (link.requires_permission ?? 'print') as PermAction;
    const permitted =
      required === 'print' && !printModelled
        ? hasEntityPermission(meta, user, 'read')
        : hasEntityPermission(meta, user, required);
    return permitted && reportLinkVisible(link, doc);
  });
  if (links.length === 0) return null;

  const openPreview = (link: EntityReportLink) => {
    setOpen(false);
    setActive(link);
  };

  const params = active ? resolveReportParams(active, doc) : {};
  const formats = active?.formats ?? ['pdf'];

  return (
    <>
      {links.length === 1 ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => openPreview(links[0] as EntityReportLink)}
          {...tid.action('print')}
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          {links[0]!.label ?? tc('ui.action.print')}
        </Button>
      ) : (
        <div className="relative" ref={menuRef}>
          <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)} {...tid.action('print')}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {tc('ui.action.print')}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          {open && (
            <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-surface py-1 shadow-lg">
              {links.map((link) => (
                <button
                  key={link.report}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm text-textMain hover:bg-bgHover"
                  {...tid.action(`print:${link.report}`)}
                  onClick={() => openPreview(link)}
                >
                  {link.label ?? link.report}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {active && (
        <ReportPreviewDialog
          open
          onClose={() => setActive(null)}
          title={active.label ?? active.report}
          src={reportRenderUrl(active.report, params, 'html')}
          printHref={reportRenderUrl(active.report, params, 'html', { print: true })}
          downloads={formats
            .filter((f) => f !== 'html')
            .map((f) => ({ label: f.toUpperCase(), href: reportRenderUrl(active.report, params, f) }))}
        />
      )}
    </>
  );
}