import { useRouteError, useNavigate } from 'react-router-dom';
import { Button } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';

/** Per-route errorElement — keeps the shell alive when a single page throws
 *  (fail-loud isolation, not a whole-app blank). */
export function PageError() {
  const error = useRouteError();
  const navigate = useNavigate();
  const tc = useChrome();
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : tc('ui.status.somethingWrong');
  return (
    <div role="alert" className="mx-auto max-w-md rounded-lg border border-error bg-error-light p-6 text-center">
      <h1 className="text-base font-semibold text-error">{tc('ui.page.failed')}</h1>
      <p className="mt-2 break-words text-sm text-textMuted">{message}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
          {tc('ui.action.back')}
        </Button>
        <Button type="button" onClick={() => window.location.reload()}>
          {tc('ui.action.reload')}
        </Button>
      </div>
    </div>
  );
}
