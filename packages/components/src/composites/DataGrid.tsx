import {
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../lib/cn.js';
import { tableSkin } from '../lib/table-skin.js';
import { Button } from '../primitives/Button.js';
import { IconButton } from '../primitives/IconButton.js';
import type { DataGridColumn, DataGridProps } from './DataGrid.types.js';

export type {
  DataGridProps,
  DataGridColumn,
  DataGridCellKind,
  DataGridAlign,
  DataGridRecomputeTrigger,
  DataGridCellPatch,
  DataGridDisplayArgs,
  DataGridEditArgs,
  DataGridApi,
} from './DataGrid.types.js';

/**
 * Generic, presentational data grid. It owns layout, row identity, row
 * virtualization, keyboard cell navigation and the active-cell editor swap. It is
 * domain-agnostic: columns and rows are plain data, cell display and editing are
 * supplied by the consumer via `renderDisplay` / `renderEditor`, and a cell edit is
 * reported as a single `{ rowId, fieldname, value }` patch, never a whole-array
 * replacement.
 *
 * Rows are windowed at a fixed row height, so thousands of rows mount only the
 * visible slice plus an overscan margin. At most one cell editor is mounted at a
 * time: a cell shows `renderDisplay` until it is activated, then swaps to
 * `renderEditor`. Arrow keys move the selected cell (scrolling it into view when it
 * is off-window); Enter / F2 / typing open the editor on an editable cell; Escape
 * discards the edit.
 */

const ALIGN: Record<NonNullable<DataGridColumn['align']>, string> = {
  start: 'justify-start text-left',
  center: 'justify-center text-center',
  end: 'justify-end text-right',
};

/** Trailing column width that holds the per-row remove control. */
const ACTION_COL = '2.5rem';
const DEFAULT_ROW_HEIGHT = 36;
const DEFAULT_MAX_BODY_HEIGHT = 480;
const DEFAULT_OVERSCAN = 8;
const FOCUSABLE = 'input, select, textarea, button, [tabindex]';

interface ActiveCell {
  rowId: string;
  key: string;
}
interface CellPos {
  row: number;
  col: number;
}

function defaultDisplay(value: unknown): ReactNode {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? '✓' : '';
  return String(value);
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="7" y="7" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 7V5.5A1.5 1.5 0 0 0 10.5 4h-6A1.5 1.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13H6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M13.5 4.5l2 2L7 15l-2.5.5L5 13l8.5-8.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function isPrintableKey(e: KeyboardEvent): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

// Nordstern F14 — per-kind minima/flex + the ONE colMin used by BOTH the
// fluid template and the F14c priority collapse (header labels never truncate).
const KIND_MIN: Record<string, number> = {
  text: 140, link: 140, select: 110, date: 100, currency: 96, number: 88, check: 64,
};
const KIND_FLEX: Record<string, number> = {
  text: 2, link: 1.5, select: 1, date: 0.9, currency: 0.8, number: 0.7, check: 0.5,
};
function colMin(c: DataGridColumn): number {
  const headerMin = c.label.length * 7 + 24 + (c.required ? 12 : 0);
  return Math.max(c.width ?? KIND_MIN[c.kind ?? 'text'] ?? 140, headerMin);
}

export function DataGrid<T = Record<string, unknown>>({
  rows,
  columns,
  getRowId,
  editable = true,
  canAddRow = false,
  canRemoveRow = false,
  autoAppendRow = false,
  maxRows = 0,
  rowHeight,
  overscan = DEFAULT_OVERSCAN,
  maxBodyHeight = DEFAULT_MAX_BODY_HEIGHT,
  onCellChange,
  onAddRow,
  onRemoveRow,
  onDuplicateRow,
  onEditRow,
  apiRef,
  onCellCommit,
  renderDisplay,
  renderEditor,
  canEditCell,
  cellClassName,
  footer,
  entrySlot,
  onPasteCells,
  addRowLabel,
  removeRowLabel,
  duplicateRowLabel,
  editRowLabel,
  className,
  'aria-label': ariaLabel,
}: DataGridProps<T>) {
  const allCols = useMemo(() => columns.filter((c) => c.visible !== false), [columns]);
  // Nordstern F14c — container-width priority collapse: when the minima exceed
  // the container, drop columns from the END (metadata order = priority) until
  // they fit (min 3 kept). Visible columns stay a stable PREFIX, so keyboard/
  // paste coordinates remain valid; a "+n" chip surfaces the hidden rest.
  const [hiddenCount, setHiddenCount] = useState(0);
  const cols = useMemo(
    () => (hiddenCount > 0 ? allCols.slice(0, Math.max(allCols.length - hiddenCount, 1)) : allCols),
    [allCols, hiddenCount],
  );
  const showRemove = editable && canRemoveRow;
  const showDuplicate = editable && !!onDuplicateRow;
  const showEdit = editable && !!onEditRow;
  const showActions = showRemove || showDuplicate || showEdit;
  const actionCount = (showEdit ? 1 : 0) + (showDuplicate ? 1 : 0) + (showRemove ? 1 : 0);
  const actionWidth = actionCount <= 1 ? ACTION_COL : `${actionCount * 2.25}rem`;
  const atMax = maxRows > 0 && rows.length >= maxRows;
  const canEdit = editable && !!renderEditor;
  const lastRow = rows.length - 1;
  const lastCol = cols.length - 1;

  // Nordstern F14 — width metadata is a MINIMUM, never a size: every column is
  // fluid (minmax) and shares spare space by kind; header labels reserve room
  // so they never truncate into "Postleit…".
  const templateColumns = useMemo(() => {
    const parts = cols.map((c) => `minmax(${colMin(c)}px, ${KIND_FLEX[c.kind ?? 'text'] ?? 1}fr)`);
    if (showActions) parts.push(actionWidth);
    return parts.join(' ');
  }, [cols, showActions, actionWidth]);

  const [active, setActive] = useState<ActiveCell | null>(null);
  const [focused, setFocused] = useState<CellPos | null>(null);
  const activeCellRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusReqRef = useRef<CellPos | null>(null);
  // Value a cell held when its editor opened — restored on Escape.
  const editStartRef = useRef<unknown>(undefined);
  // Pending programmatic edit (entry-flow advance); applied once the target row
  // renders — it may have just been appended.
  const editReqRef = useRef<{ rowId: string; columnKey: string } | null>(null);
  // One-shot guard: the active cell that has already been focused/scrolled-in by
  // the effect below, so a later re-render of the same active cell (e.g. the
  // user scrolling it out of view) does not re-trigger the scroll-to-focus.
  const surfacedRef = useRef<ActiveCell | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Density-aware row height: no explicit `rowHeight` prop → read the theme's
  // --density-row var (32/36/44 for compact/comfortable/spacious) and follow
  // the density switch live via the [data-density] attribute.
  const [densityRow, setDensityRow] = useState<number | null>(null);
  useLayoutEffect(() => {
    const read = () => {
      const el = scrollRef.current;
      if (!el) return;
      const v = parseFloat(getComputedStyle(el).getPropertyValue('--density-row'));
      setDensityRow(Number.isFinite(v) && v > 0 ? v : null);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'], subtree: true });
    return () => mo.disconnect();
  }, []);
  const effRowHeight = rowHeight ?? densityRow ?? DEFAULT_ROW_HEIGHT;

  // Nordstern F12 — pinned-column clip flags: the frame carries data-scroll-l/-r
  // so CSS shows the pin shadow/hairline ONLY while content is clipped there.
  const syncScrollFlags = () => {
    const sc = scrollRef.current;
    const f = sc?.parentElement;
    if (!sc || !f) return;
    f.dataset.scrollL = sc.scrollLeft > 2 ? 'true' : 'false';
    f.dataset.scrollR = sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 2 ? 'true' : 'false';
    // Nordstern F14c — recompute the priority collapse from the container
    // width (deterministic: depends on clientWidth + minima only).
    if (sc.clientWidth > 40) {
      const actionsPx = showActions ? Math.max(actionCount, 1) * 36 + 8 : 0;
      let visible = allCols.length;
      let sum = allCols.reduce((a, c) => a + colMin(c), 0);
      while (visible > 3 && sum + actionsPx > sc.clientWidth) {
        visible -= 1;
        sum -= colMin(allCols[visible]!);
      }
      const nextHidden = allCols.length - visible;
      if (nextHidden !== hiddenCountRef.current) {
        hiddenCountRef.current = nextHidden;
        setHiddenCount(nextHidden);
      }
    }
    // Nordstern F16 — position the floating scroll TRACK (a 14px-tall full-width
    // hit zone; the slim thumb inside grows on hover — easy to grab, click jumps).
    const tr = trackRef.current;
    const t = thumbRef.current;
    if (tr && t) {
      const need = sc.scrollWidth > sc.clientWidth + 1;
      tr.style.display = need ? 'block' : 'none';
      if (need) {
        tr.style.top = `${sc.offsetTop + sc.clientHeight - 14}px`;
        tr.style.left = `${sc.offsetLeft}px`;
        tr.style.width = `${sc.clientWidth}px`;
        const w = Math.max((sc.clientWidth / sc.scrollWidth) * sc.clientWidth, 44);
        const max = sc.scrollWidth - sc.clientWidth;
        const x = max > 0 ? (sc.scrollLeft / max) * (sc.clientWidth - w) : 0;
        t.style.width = `${w}px`;
        t.style.transform = `translateX(${x}px)`;
      }
    }
  };
  const hiddenCountRef = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const thumbDrag = useRef<{ startX: number; startLeft: number } | null>(null);
  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sc = scrollRef.current;
    const tr = trackRef.current;
    const t = thumbRef.current;
    if (!sc || !tr || !t) return;
    e.preventDefault();
    tr.setPointerCapture(e.pointerId);
    const maxScroll = sc.scrollWidth - sc.clientWidth;
    const thumbW = t.offsetWidth;
    const trackW = sc.clientWidth - thumbW;
    if (maxScroll > 0 && trackW > 0) {
      const localX = e.clientX - tr.getBoundingClientRect().left;
      const thumbX = (sc.scrollLeft / maxScroll) * trackW;
      if (localX < thumbX || localX > thumbX + thumbW) {
        // Click on the track (not the thumb): jump so the thumb centers there.
        const targetX = Math.min(Math.max(localX - thumbW / 2, 0), trackW);
        sc.scrollLeft = (targetX / trackW) * maxScroll;
      }
    }
    thumbDrag.current = { startX: e.clientX, startLeft: sc.scrollLeft };
  };
  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sc = scrollRef.current;
    const d = thumbDrag.current;
    if (!sc || !d) return;
    const maxScroll = sc.scrollWidth - sc.clientWidth;
    const trackW = sc.clientWidth - (thumbRef.current?.offsetWidth ?? 44);
    if (maxScroll <= 0 || trackW <= 0) return;
    sc.scrollLeft = d.startLeft + (e.clientX - d.startX) * (maxScroll / trackW);
  };
  const onTrackPointerUp = () => {
    thumbDrag.current = null;
  };
  useEffect(() => {
    syncScrollFlags();
    const sc = scrollRef.current;
    if (!sc || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncScrollFlags());
    ro.observe(sc);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, cols.length]);
  const pageSize = Math.max(1, Math.floor(maxBodyHeight / effRowHeight));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => effRowHeight,
    overscan,
    getItemKey: (index) => getRowId(rows[index] as T),
  });
  useLayoutEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effRowHeight]);
  const virtualItems = virtualizer.getVirtualItems();

  // Move focus into the editor when a cell becomes active. A just-appended row
  // (e.g. the entry-flow hand-off from `editCell`) may still be outside the
  // virtualized window on the render where `active` first flips true, so
  // `activeCellRef` isn't attached yet and there is nothing to focus. Re-run on
  // every `virtualItems` change (not just `active`) so that once the row scrolls
  // into view and its editor mounts, this effect fires again and focus lands —
  // requesting the scroll in the meantime, the same deferred pattern the plain
  // focus request below uses.
  //
  // `surfacedRef` makes this one-shot per active cell: once a cell has been
  // successfully focused, further `virtualItems` changes while it is STILL the
  // active cell (e.g. the user scrolling it out of view again) must not re-run
  // the scroll-in — that would fight a deliberate scroll-away. It clears
  // whenever `active` itself changes (to a different cell, or to none), the
  // same consume-on-success shape `editReqRef`/`focusReqRef` use below.
  useLayoutEffect(() => {
    if (!active) {
      surfacedRef.current = null;
      return;
    }
    const surfaced = surfacedRef.current;
    if (surfaced && surfaced.rowId === active.rowId && surfaced.key === active.key) return;
    const el = activeCellRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (el) {
      if (document.activeElement !== el) el.focus();
      surfacedRef.current = active;
      return;
    }
    const r = rows.findIndex((row) => getRowId(row) === active.rowId);
    if (r >= 0) virtualizer.scrollToIndex(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, virtualItems]);

  // Honor a pending selection-focus request. If the target cell is not mounted yet
  // (it needed a scroll to enter the virtual window), scroll it in — the resulting
  // re-render re-runs this effect, by which point the cell exists and takes focus.
  useLayoutEffect(() => {
    const req = focusReqRef.current;
    if (!req) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-rc="${req.row}-${req.col}"]`);
    if (el) {
      el.focus();
      focusReqRef.current = null;
    } else {
      virtualizer.scrollToIndex(req.row);
    }
  }, [focused, virtualItems]);

  const requestFocus = (row: number, col: number) => {
    if (rows.length === 0 || cols.length === 0) return;
    const r = Math.max(0, Math.min(lastRow, row));
    const c = Math.max(0, Math.min(lastCol, col));
    setFocused({ row: r, col: c });
    focusReqRef.current = { row: r, col: c };
    virtualizer.scrollToIndex(r);
  };

  // Programmatically begin editing a cell by row id + column key. If the row is
  // not present yet (just appended), the edit is deferred to the effect below.
  const editCell = (rowId: string, columnKey: string) => {
    const c = cols.findIndex((col) => col.key === columnKey);
    if (c < 0) return;
    const r = rows.findIndex((row) => getRowId(row) === rowId);
    if (r < 0) {
      editReqRef.current = { rowId, columnKey };
      return;
    }
    setFocused({ row: r, col: c });
    setActive({ rowId, key: columnKey });
    virtualizer.scrollToIndex(r);
  };
  if (apiRef) apiRef.current = { editCell };

  useLayoutEffect(() => {
    const req = editReqRef.current;
    if (!req) return;
    const c = cols.findIndex((col) => col.key === req.columnKey);
    const r = rows.findIndex((row) => getRowId(row) === req.rowId);
    if (c >= 0 && r >= 0) {
      editReqRef.current = null;
      setFocused({ row: r, col: c });
      setActive({ rowId: req.rowId, key: req.columnKey });
      virtualizer.scrollToIndex(r);
    }
  }, [rows, cols]);

  const onCellKeyDown = (
    e: KeyboardEvent<HTMLDivElement>,
    row: number,
    col: number,
    cellEditable: boolean,
    beginEdit: () => void,
    typeChar: (ch: string) => void,
    fillDown: () => void,
  ) => {
    if (cellEditable && e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      fillDown();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (row === lastRow && autoAppendRow && onAddRow && !atMax) {
          onAddRow();
          setFocused({ row: row + 1, col });
          focusReqRef.current = { row: row + 1, col };
        } else {
          requestFocus(row + 1, col);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        requestFocus(row - 1, col);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        requestFocus(row, col - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        requestFocus(row, col + 1);
        break;
      case 'Home':
        e.preventDefault();
        requestFocus(e.ctrlKey ? 0 : row, 0);
        break;
      case 'End':
        e.preventDefault();
        if (e.ctrlKey) requestFocus(lastRow, lastCol);
        else requestFocus(row, lastCol);
        break;
      case 'PageDown':
        e.preventDefault();
        requestFocus(row + pageSize, col);
        break;
      case 'PageUp':
        e.preventDefault();
        requestFocus(row - pageSize, col);
        break;
      case 'Enter':
      case 'F2':
        if (cellEditable) {
          e.preventDefault();
          beginEdit();
        }
        break;
      default:
        if (cellEditable && isPrintableKey(e)) {
          e.preventDefault();
          typeChar(e.key);
        }
    }
  };

  const onGridPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (active || !onPasteCells) return;
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    const pos = focused ?? { row: 0, col: 0 };
    onPasteCells({ row: pos.row, col: pos.col, text });
  };

  const onGridCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (active || !focused) return;
    const r = rows[focused.row];
    if (!r) return;
    const tsv = cols.map((c) => String((r as Record<string, unknown>)[c.key] ?? '')).join('\t');
    e.clipboardData.setData('text/plain', tsv);
    e.preventDefault();
  };

  return (
    <div
      data-ui="table"
      className={cn('relative w-full overflow-hidden', tableSkin.frame, className)}
      onPaste={onGridPaste}
      onCopy={onGridCopy}
    >
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: maxBodyHeight }} onScroll={syncScrollFlags}>
        <div role="grid" aria-label={ariaLabel} aria-rowcount={rows.length + 1} className="min-w-full text-sm">
          <div
            role="row"
            data-ui="table-header"
            aria-rowindex={1}
            className={cn('sticky top-0 z-10 grid', tableSkin.header)}
            style={{ gridTemplateColumns: templateColumns }}
          >
            {cols.map((c, ci) => (
              <div
                key={c.key}
                role="columnheader"
                title={c.tooltip}
                className={cn('flex items-center px-3 py-2', tableSkin.headerCell, ALIGN[c.align ?? 'start'], ci === 0 && 'col-pin-l')}
              >
                <span className="truncate">{c.label}</span>
                {c.required && (
                  <span className="ml-0.5 text-error" aria-hidden="true">
                    *
                  </span>
                )}
              </div>
            ))}
            {showActions && <div role="columnheader" className="col-pin-r" aria-hidden="true" />}
          </div>

          <div ref={bodyRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((vi) => {
              const row = rows[vi.index] as T;
              const rowId = getRowId(row);
              return (
                <div
                  role="row"
                  data-ui="table-row"
                  key={vi.key}
                  aria-rowindex={vi.index + 2}
                  className={cn('grid', tableSkin.row)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                    gridTemplateColumns: templateColumns,
                  }}
                >
                  {cols.map((c, colIndex) => {
                    const cellEditable =
                      canEdit && c.editable !== false && (canEditCell?.(rowId, c.key) ?? true);
                    const isActive = cellEditable && active?.rowId === rowId && active.key === c.key;
                    const isTabStop = focused
                      ? focused.row === vi.index && focused.col === colIndex
                      : vi.index === 0 && colIndex === 0;
                    const cellValue = (row as Record<string, unknown>)[c.key];
                    const beginEdit = () => {
                      editStartRef.current = cellValue;
                      setActive({ rowId, key: c.key });
                      setFocused({ row: vi.index, col: colIndex });
                    };
                    const typeChar = (ch: string) => {
                      editStartRef.current = cellValue;
                      onCellChange?.({ rowId, fieldname: c.key, value: ch });
                      setActive({ rowId, key: c.key });
                      setFocused({ row: vi.index, col: colIndex });
                    };
                    const leave = () => {
                      setActive(null);
                      if (onCellCommit) {
                        // The consumer drives the next focus (entry-flow advance).
                        onCellCommit(rowId, c.key);
                      } else {
                        setFocused({ row: vi.index, col: colIndex });
                        focusReqRef.current = { row: vi.index, col: colIndex };
                      }
                    };
                    const stepCell = (dir: number) => {
                      const cfg = c.stepper!;
                      let nextValue = Number(cellValue ?? 0) + dir * (cfg.step ?? 1);
                      if (cfg.min != null && nextValue < cfg.min) nextValue = cfg.min;
                      onCellChange?.({ rowId, fieldname: c.key, value: nextValue });
                    };
                    const fillDown = () => {
                      if (vi.index === 0) return;
                      const above = rows[vi.index - 1] as Record<string, unknown> | undefined;
                      if (above) onCellChange?.({ rowId, fieldname: c.key, value: above[c.key] });
                    };
                    return (
                      <div
                        key={c.key}
                        role="gridcell"
                        data-rc={`${vi.index}-${colIndex}`}
                        tabIndex={!isActive && isTabStop ? 0 : -1}
                        ref={isActive ? activeCellRef : undefined}
                        onFocus={() => {
                          if (!isActive) setFocused({ row: vi.index, col: colIndex });
                        }}
                        onClick={cellEditable && !isActive ? beginEdit : undefined}
                        onKeyDown={
                          isActive
                            ? undefined
                            : (e) =>
                                onCellKeyDown(e, vi.index, colIndex, cellEditable, beginEdit, typeChar, fillDown)
                        }
                        className={cn(
                          'flex items-center px-3 text-textMain outline-none',
                          colIndex === 0 && 'col-pin-l',
                          isActive ? 'overflow-visible' : 'overflow-hidden',
                          !isActive && isTabStop && 'ring-1 ring-inset ring-primary-400',
                          ALIGN[c.align ?? 'start'],
                          cellEditable && !isActive && 'cursor-text',
                          cellClassName?.({ row, column: c, rowId }),
                        )}
                      >
                        {isActive
                          ? renderEditor!({
                              row,
                              column: c,
                              rowId,
                              value: cellValue,
                              onChange: (v) => onCellChange?.({ rowId, fieldname: c.key, value: v }),
                              done: leave,
                              cancel: () => {
                                onCellChange?.({ rowId, fieldname: c.key, value: editStartRef.current });
                                leave();
                              },
                            })
                          : c.stepper && cellEditable ? (
                            <div className="flex w-full items-center gap-1">
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label="decrement"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  stepCell(-1);
                                }}
                                className="rounded border border-border px-1.5 leading-none text-textMuted hover:bg-bgHover"
                              >
                                −
                              </button>
                              <span className="flex-1 truncate text-center">
                                {renderDisplay ? renderDisplay({ row, column: c, rowId }) : defaultDisplay(cellValue)}
                              </span>
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label="increment"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  stepCell(1);
                                }}
                                className="rounded border border-border px-1.5 leading-none text-textMuted hover:bg-bgHover"
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <span className="truncate">
                              {renderDisplay
                                ? renderDisplay({ row, column: c, rowId })
                                : defaultDisplay(cellValue)}
                            </span>
                          )}
                      </div>
                    );
                  })}
                  {showActions && (
                    <div role="gridcell" className="col-pin-r flex items-center justify-center gap-1">
                      {showEdit && (
                        <IconButton
                          label={editRowLabel ?? 'Edit row'}
                          icon={<EditIcon />}
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditRow?.(rowId)}
                        />
                      )}
                      {showDuplicate && (
                        <IconButton
                          label={duplicateRowLabel ?? 'Duplicate row'}
                          icon={<DuplicateIcon />}
                          variant="ghost"
                          size="sm"
                          onClick={() => onDuplicateRow?.(rowId)}
                        />
                      )}
                      {showRemove && (
                        <IconButton
                          label={removeRowLabel ?? 'Remove row'}
                          icon={<RemoveIcon />}
                          variant="danger"
                          size="sm"
                          onClick={() => onRemoveRow?.(rowId)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {footer && (
        <div
          role="row"
          className={cn('grid', tableSkin.footer)}
          style={{ gridTemplateColumns: templateColumns }}
        >
          {cols.map((c, ci) => (
            <div key={c.key} role="cell" className={cn('flex items-center px-3 py-2', ALIGN[c.align ?? 'start'], ci === 0 && 'col-pin-l')}>
              {footer[c.key]}
            </div>
          ))}
          {showActions && <div role="cell" className="col-pin-r" aria-hidden="true" />}
        </div>
      )}

      {/* Nordstern F16 — floating scroll track: 14px hit zone, slim thumb that
          grows on hover, click on the track jumps. Only rendered when clipped. */}
      <div
        ref={trackRef}
        data-ui="grid-hscroll-track"
        role="presentation"
        aria-hidden="true"
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
        className="group absolute z-[2] h-3.5 cursor-pointer touch-none"
        style={{ display: 'none' }}
      >
        <div
          ref={thumbRef}
          data-ui="grid-hscroll"
          className="absolute bottom-1 left-0 h-1.5 cursor-grab rounded-full bg-neutral-400/60 transition-[height,background-color] duration-base group-hover:h-2 group-hover:bg-neutral-400 active:cursor-grabbing"
        />
      </div>

      {hiddenCount > 0 && (
        <div
          data-ui="grid-collapsed-chip"
          title={allCols.slice(allCols.length - hiddenCount).map((c) => c.label).join(' · ')}
          className="absolute right-1.5 top-1.5 z-[2] rounded-full bg-subtle px-1.5 py-0.5 text-micro font-medium text-textMuted"
        >
          +{hiddenCount}
        </div>
      )}

      {entrySlot && <div className="grid-entry">{entrySlot}</div>}

      {editable && canAddRow && (
        <div className="border-t border-border p-2">
          <Button variant="secondary" onClick={onAddRow} disabled={atMax}>
            {addRowLabel ?? 'Add row'}
          </Button>
        </div>
      )}
    </div>
  );
}
