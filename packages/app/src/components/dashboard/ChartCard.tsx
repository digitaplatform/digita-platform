import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChartCard as ChartCardDef, ViewSectionData } from '@digitaplatform/shared';
import { Spinner } from '@digitaplatform/components';
import { PRIMARY, ACCENT, NEUTRAL } from '@digitaplatform/theme';
import { useThemeStore } from '@/stores/theme';
import { useChrome } from '@/lib/chrome-i18n';
import { EMPTY } from '@/lib/format';
import { useMeta } from '@/hooks/useMeta';
import { CardShell, type CardStatus } from './CardShell';

/** recharts lives ONLY behind this lazy boundary (code-split off the dashboard). */
const ChartCanvas = lazy(() => import('./ChartCanvas'));

/** CSS variables read off the chart host → resolved palette passed to recharts.
 *  Safe fallbacks if a variable is missing. */
const PALETTE_VARS = [
  '--color-primary-600',
  '--color-accent-500',
  '--color-primary-400',
  '--color-accent-700',
  '--color-primary-800',
  '--color-accent-300',
];
// Fallbacks are used ONLY if getComputedStyle can't read a var (practically never
// in a browser). Sourced from the DEFAULT design's ramps via the token layer — so
// nothing off-brand is hardcoded; the ACTIVE design's real values come from the
// resolved vars above. Order mirrors PALETTE_VARS.
const PALETTE_FALLBACK = [PRIMARY[600]!, ACCENT[500]!, PRIMARY[400]!, ACCENT[700]!, PRIMARY[800]!, ACCENT[300]!];
const GRID_FALLBACK = NEUTRAL[200]!;

const CHART_TYPES = new Set(['bar', 'line', 'area', 'pie', 'donut']);

/** Width below which legend/axis chrome is dropped (CSS px). */
const COMPACT_BELOW = 320;

interface ChartCardProps {
  card: ChartCardDef;
  icon?: ReactNode;
  status: CardStatus;
  error?: string;
  data: ViewSectionData;
  /** The entity of the card's section; its field labels name the series. */
  entity?: string;
}

function resolvePalette(host: HTMLElement): string[] {
  const styles = getComputedStyle(host);
  return PALETTE_VARS.map((v, i) => {
    const raw = styles.getPropertyValue(v).trim();
    return raw || PALETTE_FALLBACK[i]!;
  });
}

/**
 * Pure chart card. Validates the chart contract loud (unknown chart_type / missing
 * x_field / empty y_fields → loud red), reads resolved theme hex once its chart host
 * exists, and lazy-loads the recharts canvas. Legitimate empty section rows render a calm note.
 */
export function ChartCard({ card, icon, status, error, data, entity }: ChartCardProps) {
  const tc = useChrome();
  const mode = useThemeStore((s) => s.mode);
  const meta = useMeta(entity);
  // State, not a ref: the host mounts only once the card is ready, usually after the first
  // render, and the measurements below have to run again when it does.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [colors, setColors] = useState<string[]>(PALETTE_FALLBACK);
  const [gridColor, setGridColor] = useState<string>(GRID_FALLBACK);
  const [compact, setCompact] = useState(false);

  // Re-resolve the theme hex whenever the mode flips — recharts gets concrete
  // colors, so a live light/dark toggle must refresh the series palette.
  useEffect(() => {
    if (!host) return;
    setColors(resolvePalette(host));
    setGridColor(getComputedStyle(host).getPropertyValue('--color-border').trim() || GRID_FALLBACK);
  }, [host, mode]);

  useEffect(() => {
    if (!host) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? host.clientWidth;
      setCompact(w < COMPACT_BELOW);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);

  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // The chart waits for the labels, so its legend never flashes the keys.
  const shellStatus = status === 'ready' && meta.isLoading ? 'loading' : status;
  if (shellStatus !== 'ready') {
    return <CardShell label={card.label} icon={icon} status={shellStatus} error={error} />;
  }
  // A key no field has (an aggregate can name one) names its series as it is.
  const seriesLabel = (key: string) => meta.data?.fields.find((f) => f.fieldname === key)?.label ?? key;

  // FAIL LOUD on a malformed chart contract.
  let configError: string | undefined;
  if (!CHART_TYPES.has(card.chart_type)) configError = `unknown chart_type '${card.chart_type}'`;
  else if (!card.x_field) configError = 'chart card has no x_field';
  else if (!Array.isArray(card.y_fields) || card.y_fields.length === 0)
    configError = 'chart card has no y_fields';
  if (configError) {
    return (
      <CardShell label={card.label} icon={icon} status="error" error={configError} />
    );
  }

  return (
    <CardShell label={card.label} icon={icon} status="ready">
      <div ref={setHost} className="h-48 w-full">
        {rows.length === 0 ? (
          <p className="flex h-full items-center text-sm text-textMuted">{EMPTY}</p>
        ) : (
          <Suspense
            fallback={
              <div
                className="flex h-full items-center justify-center text-textMuted"
                role="status"
                aria-label={tc('ui.status.loading')}
              >
                <Spinner className="h-5 w-5" />
              </div>
            }
          >
            <ChartCanvas
              card={card}
              rows={rows}
              colors={colors}
              gridColor={gridColor}
              compact={compact}
              seriesLabel={seriesLabel}
            />
          </Suspense>
        )}
      </div>
    </CardShell>
  );
}
