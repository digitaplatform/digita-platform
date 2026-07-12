import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';
import { useChrome } from '@/lib/chrome-i18n';

/** Barcode value. Phase 1 is plain text entry; camera scan is deferred to a
 *  later phase. */
export default function BarcodeControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const tc = useChrome();
  return (
    <Input
      id={controlId}
      type="text"
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder ?? tc('ui.barcode.placeholder')}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
