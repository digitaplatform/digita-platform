import { useState } from 'react';
import { BaseDialog } from './BaseDialog.js';
import { Button } from '../primitives/Button.js';
import { IconButton } from '../primitives/IconButton.js';
import { Spinner } from '../primitives/Spinner.js';

/** The kit ships no icon library — tiny inline glyphs keep it dependency-free. */
function Glyph({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}
const PRINTER = 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z';
const DOWNLOAD = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3';
const RELOAD = 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6';
const EXTERNAL = 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3';

export interface ReportDownload {
  /** Button label, e.g. "PDF". */
  label: string;
  /** Direct render URL (opens in a new tab; auth rides on the SSO cookie). */
  href: string;
}

export interface ReportPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Embedded preview URL (html render; the report service must allow this
   *  origin via CSP frame-ancestors). */
  src: string;
  /** URL of the self-printing variant (`?print=1`) — opened in a new tab so
   *  the document can call window.print() itself (a cross-origin parent
   *  cannot print an iframe). */
  printHref?: string;
  downloads?: ReportDownload[];
}

/**
 * Embedded report preview for any digita app: iframe onto the report
 * service's html render with print / download / open-in-tab actions.
 * Service-agnostic — the caller supplies ready-to-use URLs.
 */
export function ReportPreviewDialog({
  open,
  onClose,
  title,
  src,
  printHref,
  downloads = [],
}: ReportPreviewDialogProps) {
  const [loaded, setLoaded] = useState(false);
  // Bump to force an iframe reload without closing the dialog.
  const [reload, setReload] = useState(0);

  return (
    <BaseDialog open={open} onClose={onClose} title={title} size="xl" className="w-[92vw] max-w-[92vw]">
      <div className="flex h-[80vh] min-h-0 flex-col" data-testid="report-preview:dialog">
        <div className="flex items-center gap-1.5 border-b border-border pb-2">
          {printHref && (
            <Button
              size="xs"
              variant="secondary"
              leftIcon={<Glyph d={PRINTER} />}
              data-testid="report-preview:print"
              onClick={() => window.open(printHref, '_blank', 'noopener')}
            >
              Print
            </Button>
          )}
          {downloads.map((d) => (
            <Button
              key={d.label}
              size="xs"
              variant="outline"
              leftIcon={<Glyph d={DOWNLOAD} />}
              data-testid={`report-preview:download:${d.label.toLowerCase()}`}
              onClick={() => window.open(d.href, '_blank', 'noopener')}
            >
              {d.label}
            </Button>
          ))}
          <span className="flex-1" />
          <IconButton
            size="sm"
            variant="ghost"
            label="Reload preview"
            icon={<Glyph d={RELOAD} />}
            data-testid="report-preview:reload"
            onClick={() => {
              setLoaded(false);
              setReload((n) => n + 1);
            }}
          />
          <IconButton
            size="sm"
            variant="ghost"
            label="Open in new tab"
            icon={<Glyph d={EXTERNAL} />}
            data-testid="report-preview:open"
            onClick={() => window.open(src, '_blank', 'noopener')}
          />
        </div>
        <div className="relative min-h-0 flex-1">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner />
            </div>
          )}
          <iframe
            key={reload}
            title={title}
            src={src}
            className="h-full w-full border-0 bg-white"
            data-testid="report-preview:iframe"
            onLoad={() => setLoaded(true)}
          />
        </div>
      </div>
    </BaseDialog>
  );
}