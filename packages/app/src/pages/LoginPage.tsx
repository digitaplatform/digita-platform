import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { redirectToIdpLogin } from '@/lib/authConfig';
import { appUrl } from '@/lib/appBase';
import { AuthShell } from '@/templates/AuthShell';
import { useChrome } from '@/lib/chrome-i18n';
import { tid } from '@/lib/testid';

interface RedirectState {
  from?: { pathname: string; search?: string };
}

/**
 * No login form: the tenant IdP owns the password and 2FA halves. This route
 * only hands the browser over, carrying the route the user wanted as the
 * bounce-back target — `/login` itself must never be that target, or the IdP
 * would send an already signed-in user straight back here.
 */
export default function LoginPage() {
  const location = useLocation();
  const tc = useChrome();
  const from = (location.state as RedirectState | null)?.from;
  const wanted = from ? `${from.pathname}${from.search ?? ''}` : '/';

  useEffect(() => {
    redirectToIdpLogin(`${window.location.origin}${appUrl(wanted)}`);
  }, [wanted]);

  return (
    <AuthShell>
      <div className="space-y-1 text-center" {...tid.page('login')}>
        <h1 className="text-lg font-semibold text-textMain">{tc('ui.login.title')}</h1>
        <p className="text-xs text-textMuted" data-testid="login-redirecting">
          {tc('ui.login.redirecting')}
        </p>
      </div>
    </AuthShell>
  );
}
