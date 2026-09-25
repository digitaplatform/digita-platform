import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';
import { useChrome } from '@/lib/chrome-i18n';

/** GeoJSON Point. Value is `{ type:'Point', coordinates:[lng,lat] }` or null.
 *  Two side-by-side number inputs (lng, lat). Emits `undefined` when both are
 *  blank so conditional-required can tell empty from a real 0. */
export default function GeolocationControl({
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const tc = useChrome();
  const point = value as { coordinates?: [number, number] } | null | undefined;
  const coords = point?.coordinates;
  const lng = coords?.[0];
  const lat = coords?.[1];

  const rebuild = (nextLng: string, nextLat: string) => {
    if (nextLng === '' && nextLat === '') {
      onChange(null); // null (not undefined) survives JSON.stringify so the clear reaches the engine
      return;
    }
    onChange({
      type: 'Point',
      coordinates: [nextLng === '' ? 0 : Number(nextLng), nextLat === '' ? 0 : Number(nextLat)],
    });
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        id={controlId}
        type="number"
        step="any"
        inputMode="decimal"
        className="text-right tabular-nums"
        aria-labelledby={labelId}
        aria-describedby={describedBy(describedById, errorId)}
        aria-required={state.required || undefined}
        aria-invalid={state.invalid || undefined}
        readOnly={state.readOnly}
        placeholder={tc('ui.geo.longitude')}
        value={lng == null ? '' : String(lng)}
        onChange={(e) => rebuild(e.target.value, lat == null ? '' : String(lat))}
      />
      <Input
        type="number"
        step="any"
        inputMode="decimal"
        className="text-right tabular-nums"
        aria-required={state.required || undefined}
        aria-invalid={state.invalid || undefined}
        readOnly={state.readOnly}
        placeholder={tc('ui.geo.latitude')}
        value={lat == null ? '' : String(lat)}
        onChange={(e) => rebuild(lng == null ? '' : String(lng), e.target.value)}
      />
    </div>
  );
}
