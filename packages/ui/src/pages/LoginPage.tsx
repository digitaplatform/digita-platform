import { type SyntheticEvent, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { AuthShell } from '@/templates/AuthShell';
import { Button, Input } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { tid } from '@/lib/testid';

interface RedirectState {
  from?: { pathname: string };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const tc = useChrome();
  const status = useSessionStore((s) => s.status);
  const login = useSessionStore((s) => s.login);
  const verify2fa = useSessionStore((s) => s.verify2fa);

  const [step, setStep] = useState<'credentials' | 'totp'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const redirectTo = (location.state as RedirectState | null)?.from?.pathname ?? '/';

  // A successful login flips status to authenticated — leave the login screen.
  useEffect(() => {
    if (status === 'authenticated') navigate(redirectTo, { replace: true });
  }, [status, navigate, redirectTo]);

  async function handleCredentials(e: SyntheticEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { requires2fa } = await login(email, password);
      if (requires2fa) setStep('totp');
    } catch {
      setError(tc('ui.login.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: SyntheticEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await verify2fa(code.trim());
    } catch {
      setError(tc('ui.login.invalidCode'));
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      {step === 'credentials' ? (
        <form onSubmit={handleCredentials} className="space-y-4" noValidate {...tid.page('login')}>
          <header className="space-y-1">
            <h1 className="text-lg font-semibold text-textMain">{tc('ui.login.title')}</h1>
            <p className="text-xs text-textMuted">{tc('ui.login.subtitle')}</p>
          </header>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-textMuted" htmlFor="email">{tc('ui.account.profile.email')}</label>
            <Input
              id="email"
              data-testid="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-textMuted" htmlFor="password">{tc('ui.account.password.title')}</label>
            <Input
              id="password"
              data-testid="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-xs text-error" data-testid="login-error">{error}</p>}
          <Button type="submit" className="w-full" loading={loading} data-testid="login-submit">
            <LogIn className="h-4 w-4" />
            {tc('ui.login.title')}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleTotp} className="space-y-4" noValidate>
          <header className="space-y-1">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-textMain">
              <ShieldCheck className="h-5 w-5 text-primary-600" />
              {tc('ui.login.twofaTitle')}
            </h1>
            <p className="text-xs text-textMuted">{tc('ui.login.twofaHint')}</p>
          </header>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoFocus
            required
          />
          {error && <p className="text-xs text-error">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            {tc('ui.login.verify')}
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs text-textMuted hover:text-textMain"
            onClick={() => {
              setStep('credentials');
              setCode('');
              setError(null);
            }}
          >
            {tc('ui.action.back')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
