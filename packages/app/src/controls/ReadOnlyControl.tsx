import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Display-only text in the kit's locked input frame, so it reads like every other locked
 *  field of the form and a design's read-only frame rules reach it. It stays in the tab
 *  order like a locked Data field, so its value can be selected and copied.
 *  Renders an em-dash for null/empty values. */
export default function ReadOnlyControl({ value, controlId, labelId, describedById, errorId }: FieldControlProps) {
  return (
    <Input
      id={controlId}
      framed
      readOnly
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      value={value == null || value === '' ? '—' : String(value)}
    />
  );
}
