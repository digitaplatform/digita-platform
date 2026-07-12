import { Switch } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Boolean field, rendered as a Switch — the modern one-control-per-semantic
 *  toggle (the iOS/Material variant layers give it their native switch look).
 *  Stores 0/1 (the engine's Check convention) and tolerates a boolean inbound
 *  value. Selection checkboxes (grids, "select all") stay Checkbox. */
export default function CheckControl({
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const checked = value === 1 || value === true;
  return (
    <Switch
      id={controlId}
      aria-labelledby={labelId}
      aria-describedby={describedBy(describedById, errorId)}
      checked={checked}
      disabled={state.readOnly}
      onChange={(next) => onChange(next ? 1 : 0)}
    />
  );
}
