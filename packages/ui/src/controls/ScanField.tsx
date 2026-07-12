import { useRef, useState } from 'react';
import { cn } from '@digitaplatform/components';
import type { ScanResolveConfig, ScanResolveRule, ViewSectionData } from '@digitaplatform/shared';
import { getView } from '@/services/resource';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Scan-mode input for the entry grid (`scan_entry` on a Table field).
 *
 * A keyboard-wedge scanner is a keyboard: it types the code and sends Enter.
 * The whole design serves ONE property — speed:
 *  - Enter resolves the code via `resolve.view` and builds a hit from its
 *    `sections` per `resolve.try` (see @digitaplatform/shared `ScanResolveConfig` /
 *    `ViewResult`) and hands the hit to the host, which merges (+1) or adds a
 *    complete line via `onScan`. No dialog, no field-by-field entry flow,
 *    focus stays here for the next scan.
 *  - `5*<code>` multiplies like a supermarket till.
 *  - Feedback works without looking: a bright double beep + green pulse on
 *    success, a low tone + shake on a miss. An unknown code stays selected —
 *    the next scan overwrites it; Enter again hands it to the link search
 *    instead (`onSearchFallback`).
 */

/**
 * A resolved scan: the picked link id plus an app-defined bag of values.
 * The control never names what's inside `fields` — an app maps them onto row
 * fields via that field's `scan_entry.field_map`.
 */
export interface ScanHit {
  /** Picked id, fed into the row's `add_via_link` field. */
  link: string;
  /** App-resolved values for the hit, applied generically via `field_map`. */
  fields: Record<string, unknown>;
  /** Optional human-readable label for the hit — display only, no row effect. */
  label?: string;
}

/** A view section is an array of rows, a single aggregate row, or null/absent
 *  (see `ViewSectionData`) — normalize to the row a resolve rule tries. */
function firstRow(section: ViewSectionData | undefined): Record<string, unknown> | undefined {
  if (Array.isArray(section)) return section[0];
  return section ?? undefined;
}

/** Apply one matched `ScanResolveRule` row into a `ScanHit`, generically —
 *  no section or field name is known here, only what `rule` names. */
function buildHit(rule: ScanResolveRule, row: Record<string, unknown>): ScanHit | null {
  const link = row[rule.link];
  if (typeof link !== 'string' || !link) return null;
  const fields: Record<string, unknown> = {};
  if (rule.fields) for (const [hitKey, rowField] of Object.entries(rule.fields)) fields[hitKey] = row[rowField];
  if (rule.set) Object.assign(fields, rule.set);
  const label = rule.label ? row[rule.label] : undefined;
  return { link, fields, label: typeof label === 'string' ? label : undefined };
}

interface ScanFieldProps {
  /** How to turn a scanned code into a hit (`field.scan_entry.resolve`). */
  resolve: ScanResolveConfig;
  /** Host merges or adds the line; returns what happened (drives feedback). */
  onScan: (hit: ScanHit, multiplier: number) => 'merged' | 'added';
  /** Second Enter on an unknown code: hand it to the link search. */
  onSearchFallback?: (code: string) => void;
  testId?: string;
}

type Feedback =
  | { kind: 'ok'; text: string }
  | { kind: 'miss'; code: string }
  | null;

/** Supermarket-till multiplier prefix: `5*4012345678901`. */
export function parseScan(raw: string): { code: string; multiplier: number } | null {
  const value = raw.trim();
  if (!value) return null;
  const m = /^(\d{1,3})\*(.+)$/.exec(value);
  if (m) {
    const multiplier = Number(m[1]);
    const code = m[2]!.trim();
    if (multiplier > 0 && code) return { code, multiplier };
  }
  return { code: value, multiplier: 1 };
}

/** Checkout beep via a throwaway oscillator — no asset, inaudible env = no-op. */
function beep(ok: boolean): void {
  try {
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const tone = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.04;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur);
    };
    if (ok) {
      tone(1200, 0, 0.06);
      tone(1600, 0.07, 0.06);
    } else {
      tone(220, 0, 0.18);
    }
    setTimeout(() => void ctx.close(), 400);
  } catch {
    /* audio is a nicety — never let it break scanning */
  }
}

export function ScanField({ resolve, onScan, onSearchFallback, testId }: ScanFieldProps) {
  const tc = useChrome();
  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  // The code of the last miss — Enter on the SAME value goes to search.
  const lastMissRef = useRef<string | null>(null);

  const commit = async () => {
    const input = inputRef.current;
    if (!input || busy) return;
    const parsed = parseScan(input.value);
    if (!parsed) return;

    if (lastMissRef.current === input.value.trim() && onSearchFallback) {
      lastMissRef.current = null;
      const code = parsed.code;
      input.value = '';
      setFeedback(null);
      onSearchFallback(code);
      return;
    }

    setBusy(true);
    try {
      const param = resolve.param ?? 'code';
      const res = await getView(resolve.view, { [param]: parsed.code });
      const sections = res.data?.sections ?? {};
      // First `try` rule whose section carries a row wins — a generic
      // priority list, not a hardcoded branch on any particular section.
      let hit: ScanHit | null = null;
      for (const rule of resolve.try) {
        const row = firstRow(sections[rule.section]);
        if (!row) continue;
        hit = buildHit(rule, row);
        break;
      }

      if (!hit) {
        lastMissRef.current = input.value.trim();
        beep(false);
        setFeedback({ kind: 'miss', code: parsed.code });
        input.select(); // next scan overwrites; Enter again = search fallback
        return;
      }

      lastMissRef.current = null;
      const outcome = onScan(hit, parsed.multiplier);
      beep(true);
      setFeedback({
        kind: 'ok',
        text: `${outcome === 'merged' ? '+' : ''}${parsed.multiplier}${hit.label ? ` · ${hit.label}` : ''}`,
      });
      input.value = '';
    } finally {
      setBusy(false);
      inputRef.current?.focus(); // the loop: ready for the next scan
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'flex min-w-64 items-center gap-2 rounded-input border bg-surface px-2.5 py-1.5 transition-colors duration-base',
          feedback?.kind === 'miss'
            ? 'anim-toast-in border-error'
            : feedback?.kind === 'ok'
              ? 'border-success'
              : 'border-border focus-within:shadow-focus',
        )}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-textMuted">
          <path
            d="M3 5v10M6 5v10M8.5 5v10M12 5v10M14.5 5v10M17 5v10"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder={tc('ui.scan.placeholder')}
          aria-label={tc('ui.scan.placeholder')}
          data-testid={testId}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              void commit();
            }
          }}
          className="w-full bg-transparent text-sm text-textMain placeholder:text-textMuted focus:outline-none"
        />
      </div>
      {feedback?.kind === 'ok' && (
        <span data-testid="scan-feedback" className="text-caption tabular-nums text-success">
          ✓ {feedback.text}
        </span>
      )}
      {feedback?.kind === 'miss' && (
        <span data-testid="scan-feedback" role="alert" className="text-caption text-error">
          {tc('ui.scan.notFound')}
        </span>
      )}
    </div>
  );
}
