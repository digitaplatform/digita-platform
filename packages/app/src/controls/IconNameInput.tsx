import { useId } from 'react';
import { icons } from 'lucide-react';
import { Input } from '@digitaplatform/components';
import { lucideIcon } from '@/lib/lucide-icon';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

// Every lucide icon by the kebab name a person types, such as "layout-dashboard".
const ICON_NAMES = Object.keys(icons).map((name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());

/** A Data field of format "Icon": the name of a lucide icon, offered from the full list as a person
 *  types, with the icon it names beside it. */
export default function IconNameInput({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const listId = useId();
  const name = value == null ? '' : String(value);
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-textMuted" data-component="icon-preview">
        {lucideIcon(name || undefined, 18)}
      </span>
      <Input
        id={controlId}
        type="text"
        list={listId}
        autoComplete="off"
        aria-labelledby={labelId}
        aria-describedby={describedBy(describedById, errorId)}
        aria-required={state.required || undefined}
        aria-invalid={state.invalid || undefined}
        readOnly={state.readOnly}
        placeholder={field.placeholder}
        value={name}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
      <datalist id={listId}>
        {ICON_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}
