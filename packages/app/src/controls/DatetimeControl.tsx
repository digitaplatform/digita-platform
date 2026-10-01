import { useState } from 'react';
import { DatePicker, Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';
import { formatWallTime, fromDatetimeInput, parseWallTime, toDatetimeInput } from '@/lib/format';
import { useChrome } from '@/lib/chrome-i18n';
import { useSessionStore } from '@/stores/session';

/** Date + time on the wall clock of the person's time zone, the time the list shows.
 *  The date sits on the kit's DatePicker and the time in a text box, both in the app's
 *  format locale as a Date field is: a browser's own date and time input follows the
 *  browser's language instead. The stored UTC instant is converted for display, and
 *  date and time the person gives are stored as their UTC instant; emits `undefined`
 *  when the date is cleared. */
export default function DatetimeControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const timezone = useSessionStore((s) => s.locale?.timezone);
  const formatLocale = useSessionStore((s) => s.locale?.format_locale);
  const tc = useChrome();
  const wall = toDatetimeInput(value, timezone);
  const stored = /^\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)
    ? { date: wall.slice(0, -6), time: wall.slice(-5) }
    : { date: '', time: '' };
  // A date or a time given alone waits here for the other half: an instant needs both, and
  // either half made up would store a moment the person never named.
  const [draft, setDraft] = useState<{ date?: string; time?: string }>({});
  // What the person types into the time box, until it leaves the box and is read.
  const [typed, setTyped] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const date = draft.date ?? stored.date;
  const time = draft.time ?? stored.time;

  const put = (next: { date: string; time: string }) => {
    if (next.date && next.time) {
      setDraft({});
      onChange(fromDatetimeInput(`${next.date}T${next.time}`, timezone));
    } else {
      setDraft(next);
    }
  };

  const readTyped = () => {
    if (typed === null) return;
    const read = parseWallTime(typed, formatLocale);
    setUnreadable(!read);
    if (!read) return;
    setTyped(null);
    put({ date, time: read });
  };

  const timeLabelId = `${controlId}-time`;
  // A stored value that is no instant is shown as it is rather than hidden.
  const shownTime = typed ?? (time ? formatWallTime(time, formatLocale) : stored.date ? '' : wall);
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <DatePicker
          id={controlId}
          locale={formatLocale}
          aria-labelledby={labelId}
          aria-describedby={describedBy(describedById, errorId)}
          aria-required={state.required || undefined}
          invalid={state.invalid}
          disabled={state.readOnly}
          placeholder={field.placeholder}
          clearLabel={tc('ui.action.clear')}
          previousLabel={tc('ui.datepicker.previousMonth')}
          nextLabel={tc('ui.datepicker.nextMonth')}
          previousYearsLabel={tc('ui.datepicker.previousYears')}
          nextYearsLabel={tc('ui.datepicker.nextYears')}
          value={date || undefined}
          onChange={(picked) => {
            if (!picked) {
              setDraft({});
              setTyped(null);
              setUnreadable(false);
              onChange(undefined);
              return;
            }
            put({ date: picked, time });
          }}
        />
      </div>
      <span id={timeLabelId} hidden>
        {tc('ui.datetime.time')}
      </span>
      <Input
        className="w-32 shrink-0"
        aria-labelledby={`${labelId} ${timeLabelId}`}
        aria-describedby={describedBy(describedById, errorId)}
        aria-required={state.required || undefined}
        aria-invalid={state.invalid || unreadable || undefined}
        readOnly={state.readOnly}
        inputMode="text"
        value={shownTime}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={readTyped}
        onKeyDown={(e) => {
          if (e.key === 'Enter') readTyped();
        }}
      />
    </div>
  );
}
