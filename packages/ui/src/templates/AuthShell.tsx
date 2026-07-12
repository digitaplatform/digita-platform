import { type ReactNode } from 'react';
import { useSessionStore } from '@/stores/session';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';

/** Unauthenticated chrome — a centered card on the branded background. The logo
 *  and app name come from the branding payload (falls back to the platform
 *  name, then "Digita"). A language picker (backend languages) sits top-right so
 *  the operator can choose their language before signing in. */
export function AuthShell({ children }: { children: ReactNode }) {
  const branding = useSessionStore((s) => s.branding);
  const platformName = useSessionStore((s) => s.settings?.platform_name);
  const appName = branding?.app_name ?? platformName ?? 'Digita';

  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-background p-4"
      style={branding?.login_background ? { backgroundImage: `url(${branding.login_background})`, backgroundSize: 'cover' } : undefined}
    >
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          {branding?.logo ? (
            <img src={branding.logo} alt="" className="h-10" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-card bg-primary-600 text-lg font-bold text-white shadow-sm">
              {appName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-sm font-medium text-textMuted">{appName}</span>
        </div>
        <div className="rounded-dialog border border-border bg-surface p-8 shadow-lg">{children}</div>
      </div>
    </div>
  );
}
