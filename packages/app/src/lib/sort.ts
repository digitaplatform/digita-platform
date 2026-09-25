/**
 * Multi-column sort encoded in the `order_by` URL param as the engine reads it:
 * a comma-separated list of `<field> <asc|desc>` segments (engine
 * mongodb-service.parseOrderBy splits on ","). The UI gesture:
 *   plain click   → sort by this field ALONE (toggle asc/desc if already the sole sort)
 *   Shift + click → ADD this field as another level (cycle asc → desc → removed)
 */

export interface SortSeg {
  field: string;
  dir: 'asc' | 'desc';
}

export function parseSort(orderBy?: string): SortSeg[] {
  return (orderBy ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [field, dir] = p.split(/\s+/);
      return { field: field ?? '', dir: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' } as SortSeg;
    })
    .filter((s) => s.field);
}

export function serializeSort(segs: SortSeg[]): string | undefined {
  return segs.length ? segs.map((s) => `${s.field} ${s.dir}`).join(', ') : undefined;
}

/**
 * Next `order_by` value after clicking `field`. `additive` (Shift-click) keeps the
 * other levels and cycles this field asc → desc → removed; a plain click collapses
 * to this field alone (toggling its direction when it is already the only sort).
 * Returns `undefined` when no sort remains (caller drops the param → default sort).
 */
export function nextSort(orderBy: string | undefined, field: string, additive: boolean): string | undefined {
  const segs = parseSort(orderBy);
  const idx = segs.findIndex((s) => s.field === field);
  let next: SortSeg[];
  if (additive) {
    if (idx === -1) next = [...segs, { field, dir: 'asc' }];
    else if (segs[idx]!.dir === 'asc') next = segs.map((s, i) => (i === idx ? { ...s, dir: 'desc' } : s));
    else next = segs.filter((_, i) => i !== idx);
  } else {
    next =
      segs.length === 1 && idx === 0
        ? [{ field, dir: segs[0]!.dir === 'asc' ? 'desc' : 'asc' }]
        : [{ field, dir: 'asc' }];
  }
  return serializeSort(next);
}
