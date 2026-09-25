import type { FieldControlProps } from '@/controls/types';

/** READ-ONLY image display. Value is an image URL string (or empty). */
export default function ImageControl({ value }: FieldControlProps) {
  if (typeof value === 'string' && value !== '') {
    return <img src={String(value)} alt="" className="max-h-32 rounded border border-border" />;
  }
  return <span className="text-sm text-textMuted">—</span>;
}
