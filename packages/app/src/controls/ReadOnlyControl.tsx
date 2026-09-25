import type { FieldControlProps } from '@/controls/types';

/** Display-only text. Renders an em-dash for null/empty values. */
export default function ReadOnlyControl({ value }: FieldControlProps) {
  return (
    <span className="text-sm text-textMain">{value == null || value === '' ? '—' : String(value)}</span>
  );
}
