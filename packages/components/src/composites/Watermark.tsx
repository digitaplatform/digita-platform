import { useId } from 'react';
import { cn } from '../lib/cn.js';

export type WatermarkTone = 'warning' | 'error' | 'info' | 'neutral';
export type WatermarkDensity = 'sparse' | 'normal' | 'dense';

export interface WatermarkProps {
  /** The stamp text — rendered UPPERCASE, tiled diagonally (e.g. "Sample data"). */
  label: string;
  /** Token color of the stamp; `warning` is the "this is fake/placeholder" default. */
  tone?: WatermarkTone;
  /** Tile spacing — how tightly the label repeats. */
  density?: WatermarkDensity;
  className?: string;
}

const TONES: Record<WatermarkTone, string> = {
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  neutral: 'text-textMuted',
};

/** Pattern-tile geometry per density (bigger tile = sparser stamp). */
const TILE: Record<WatermarkDensity, { height: number; gap: number; font: number }> = {
  sparse: { height: 160, gap: 112, font: 14 },
  normal: { height: 112, gap: 72, font: 14 },
  dense: { height: 72, gap: 44, font: 13 },
};

/**
 * Repeating diagonal stamp overlay ("SAMPLE DATA") that fills its
 * relatively-positioned parent — the loud-but-unobtrusive marker for fake /
 * placeholder / draft content. One inline SVG pattern (vector, any parent size,
 * `currentColor` so the tone rides the theme tokens) at low opacity;
 * pointer-events-none so the content below stays fully interactive. The label
 * is also announced once to assistive tech via a visually-hidden span.
 */
export function Watermark({ label, tone = 'warning', density = 'normal', className }: WatermarkProps) {
  // useId emits colons — strip to keep the SVG funcIRI (`url(#…)`) parseable.
  const patternId = `wm-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const text = label.toUpperCase();
  const tile = TILE[density];
  // Approximate glyph advance (~0.66em bold tracking-wide) — the tile just has
  // to comfortably FIT the text; exactness doesn't matter for a stamp.
  const width = Math.max(1, Math.round(text.length * tile.font * 0.66 + tile.gap));

  return (
    <div
      data-ui="watermark"
      data-tone={tone}
      data-density={density}
      className={cn('pointer-events-none absolute inset-0 select-none overflow-hidden', TONES[tone], className)}
    >
      <svg aria-hidden="true" className="h-full w-full opacity-10">
        <defs>
          <pattern
            id={patternId}
            width={width}
            height={tile.height}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-30)"
          >
            <text
              x={width / 2}
              y={tile.height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="currentColor"
              fontSize={tile.font}
              fontWeight={700}
              letterSpacing="0.18em"
              fontFamily="var(--font-sans)"
            >
              {text}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}
