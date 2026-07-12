import type { FieldControlProps } from '@/controls/types';
import { useChrome } from '@/lib/chrome-i18n';

/** Phase-1 READ-ONLY display of a captured signature (a data-URL string).
 *  Capture is deferred — no canvas here. */
export default function SignatureControl({ value }: FieldControlProps) {
  const tc = useChrome();
  if (typeof value === 'string' && value !== '') {
    return <img src={String(value)} alt={tc('ui.signature.alt')} className="max-h-24 rounded border border-border" />;
  }
  return <span className="text-sm text-textMuted">{tc('ui.signature.empty')}</span>;
}
