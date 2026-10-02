import { lazy, Suspense } from 'react';
import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

// The full lucide set loads only for a form that shows an icon field.
const IconNameInput = lazy(() => import('@/controls/IconNameInput'));

/** Single-line text. Built-in `options` formats (Email/URL/...) only hint the
 *  input type; validation is enforced by the zod schema. The format "Icon" picks a lucide icon name. */
export default function DataControl(props: FieldControlProps) {
  const { field, value, state, onChange, controlId, labelId, describedById, errorId } = props;
  const opt = typeof field.options === 'string' ? field.options : undefined;
  if (opt === 'Icon') {
    return (
      <Suspense fallback={null}>
        <IconNameInput {...props} />
      </Suspense>
    );
  }
  const type = opt === 'Email' ? 'email' : opt === 'URL' ? 'url' : 'text';
  return (
    <Input
      id={controlId}
      type={type}
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      aria-required={state.required || undefined}
      aria-invalid={state.invalid || undefined}
      readOnly={state.readOnly}
      placeholder={field.placeholder}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
