import { useId, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { Button, Card, Select } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { formatCurrency, formatDate, formatDatetime, formatNumber } from '@/lib/format';

/**
 * Region & timezone editor. The UI LANGUAGE (which strings) lives on the Profile
 * card; this sets the FORMATTING region (BCP-47 format_locale, e.g. de-CH vs
 * de-DE) + the display timezone — so a Swiss user can read a German UI with Swiss
 * number/date formatting. PURE: current values + onSave; AccountPage owns the
 * store write (UserPreference, roams cross-device). A live preview shows the
 * pending selection before saving. Native-name labels need no per-locale strings.
 */

/** Curated BCP-47 formatting regions (native labels). `''` = follow the UI language. */
const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: 'de-CH', label: 'Deutsch — Schweiz (de-CH)' },
  { value: 'de-DE', label: 'Deutsch — Deutschland (de-DE)' },
  { value: 'de-AT', label: 'Deutsch — Österreich (de-AT)' },
  { value: 'fr-CH', label: 'Français — Suisse (fr-CH)' },
  { value: 'fr-FR', label: 'Français — France (fr-FR)' },
  { value: 'it-CH', label: 'Italiano — Svizzera (it-CH)' },
  { value: 'it-IT', label: 'Italiano — Italia (it-IT)' },
  { value: 'en-US', label: 'English — United States (en-US)' },
  { value: 'en-GB', label: 'English — United Kingdom (en-GB)' },
  { value: 'es-ES', label: 'Español — España (es-ES)' },
  { value: 'tr-TR', label: 'Türkçe — Türkiye (tr-TR)' },
];

/** All IANA timezones (CLDR via Intl) — fall back to a small curated set on
 *  runtimes without supportedValuesOf. */
function timezoneList(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof fn === 'function') return fn('timeZone');
  } catch {
    /* fall through to the curated set */
  }
  return [
    'UTC',
    'Europe/Zurich',
    'Europe/Berlin',
    'Europe/Paris',
    'Europe/Rome',
    'Europe/Madrid',
    'Europe/Istanbul',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
  ];
}

export interface RegionCardProps {
  /** Current formatting region from /boot (may be a bare language when unset). */
  formatLocale?: string;
  /** Current display timezone from /boot, or null when device-local. */
  timezone?: string | null;
  /** Currency for the preview (boot system_settings.default_currency). */
  currency?: string;
  onSave: (formatLocale: string | null, timezone: string | null) => void;
  saving: boolean;
  /** Server-level failure surfaced by the page (calm inline alert). */
  error?: string;
}

export function RegionCard({ formatLocale, timezone, currency, onSave, saving, error }: RegionCardProps) {
  const tc = useChrome();
  const regionId = useId();
  const regionLabelId = useId();
  const tzId = useId();
  const tzLabelId = useId();
  const errId = useId();

  const zones = useMemo(timezoneList, []);

  // A bare language (e.g. "de") is "follow language" → maps to the default ('').
  const initialRegion = formatLocale && REGION_OPTIONS.some((o) => o.value === formatLocale) ? formatLocale : '';
  const initialTz = timezone ?? '';

  const [region, setRegion] = useState(initialRegion);
  const [tz, setTz] = useState(initialTz);

  const dirty = region !== initialRegion || tz !== initialTz;

  const regionOptions = [{ value: '', label: tc('ui.account.region.formatLocaleDefault') }, ...REGION_OPTIONS];
  const tzOptions = [
    { value: '', label: tc('ui.account.region.timezoneDefault') },
    ...zones.map((z) => ({ value: z, label: z })),
  ];

  // The preview uses the PENDING selection; an empty region previews in the UI
  // language (what the engine resolver falls back to).
  const previewLocale = region || document.documentElement.lang || undefined;
  const previewTz = tz || undefined;
  const now = new Date();

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!dirty || saving) return;
    onSave(region === '' ? null : region, tz === '' ? null : tz);
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4" aria-describedby={error ? errId : undefined}>
        <header className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-subtle text-textMuted">
            <Globe className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-textMain">{tc('ui.account.region.title')}</h2>
            <p className="mt-0.5 text-sm text-textMuted">{tc('ui.account.region.hint')}</p>
          </div>
        </header>

        {error && (
          <div id={errId} role="alert" className="rounded-md bg-error-light p-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label id={regionLabelId} htmlFor={regionId} className="block text-sm font-medium text-textMain">
              {tc('ui.account.region.formatLocale')}
            </label>
            <Select
              id={regionId}
              aria-labelledby={regionLabelId}
              value={region}
              onChange={setRegion}
              disabled={saving}
              options={regionOptions}
            />
          </div>

          <div className="space-y-1">
            <label id={tzLabelId} htmlFor={tzId} className="block text-sm font-medium text-textMain">
              {tc('ui.account.region.timezone')}
            </label>
            <Select
              id={tzId}
              aria-labelledby={tzLabelId}
              value={tz}
              onChange={setTz}
              disabled={saving}
              searchable
              searchPlaceholder={tc('ui.account.region.timezoneSearch')}
              noResultsLabel={tc('ui.account.region.timezoneNoResults')}
              options={tzOptions}
            />
          </div>
        </div>

        <div className="rounded-card border border-border bg-subtle/50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-textMuted">
            {tc('ui.account.region.preview')}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
            <PreviewItem label={tc('ui.account.region.previewNumber')} value={formatNumber(1234567.89, previewLocale, { precision: 2 })} />
            <PreviewItem label={tc('ui.account.region.previewCurrency')} value={formatCurrency(1234567.89, previewLocale, currency)} />
            <PreviewItem label={tc('ui.account.region.previewDate')} value={formatDate(now, previewLocale)} />
            <PreviewItem label={tc('ui.account.region.previewDatetime')} value={formatDatetime(now, previewLocale, previewTz)} />
          </dl>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!dirty || saving}>
            {tc('ui.account.region.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-textMuted">{label}</dt>
      <dd className="truncate font-medium tabular-nums text-textMain">{value}</dd>
    </div>
  );
}
