import { useLocation } from 'react-router-dom';
import { Puzzle } from 'lucide-react';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Fallback for `url`-kind menu targets (e.g. /app/view/customer360) until a
 * plugin registers the matching route. Once the runtime plugin loader lands,
 * these routes resolve to real plugin pages.
 */
export default function PluginPagePlaceholder() {
  const { pathname } = useLocation();
  const tc = useChrome();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-subtle text-textMuted">
        <Puzzle className="h-6 w-6" />
      </div>
      <h1 className="text-lg font-semibold text-textMain">{tc('ui.plugin.placeholderTitle')}</h1>
      <p className="max-w-sm text-sm text-textMuted">
        <code className="rounded bg-subtle px-1.5 py-0.5 text-xs">{pathname}</code>{' '}
        {tc('ui.plugin.placeholderBody')}
      </p>
    </div>
  );
}
