import { Link, useLocation } from 'react-router-dom';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * The frame's notice while the app is not set up: the engine refuses every new record until then,
 * so each page says it before anybody fills a form. A user who may complete the setup gets the
 * way to its page, everyone else whom to ask. The setup page says all of it itself.
 */
export function SetupNotice() {
  const setup = useSessionStore((s) => s.setup);
  const { pathname } = useLocation();
  const tc = useChrome();

  if (!setup || setup.complete || pathname === '/_setup') return null;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning bg-warning-light px-4 py-3 text-sm text-textMain"
    >
      <p>
        {tc('ui.setup.notice')}
        {setup.records.length === 0 && ` ${tc('ui.setup.askAdministrator')}`}
      </p>
      {setup.records.length > 0 && (
        <Link
          to="/_setup"
          className="rounded font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {tc('ui.setup.title')}
        </Link>
      )}
    </div>
  );
}
