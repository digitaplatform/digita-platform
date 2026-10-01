/**
 * The calendar day of `instant` in `timeZone` (an IANA name), as the "YYYY-MM-DD" string a Date
 * field stores. A tenant's "today" is its own day: at 00:30 in Zurich, UTC is still on yesterday.
 * An unknown zone throws the RangeError of Intl, as no day can be named in it.
 */
export function calendarDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
