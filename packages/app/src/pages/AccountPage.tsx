import { useState } from 'react';
import { Badge, Button, Card } from '@digitaplatform/components';
import { ApiClientError } from '@/lib/errors';
import { TranslationsLoadError } from '@/stores/i18n';
import { ErrorBlock } from '@/components/status';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';
import { useDialogHost } from '@/components/overlay/DialogHost';
import {
  useSessions,
  useProfileUpdate,
  usePasswordChange,
  useRevokeSession,
  useRevokeOtherSessions,
} from '@/hooks/useAccount';
import type { ChangePasswordRequest } from '@/services/account';
import type { SessionUser } from '@/types';
import { ProfileCard } from '@/components/account/ProfileCard';
import { RegionCard } from '@/components/account/RegionCard';
import { PasswordCard } from '@/components/account/PasswordCard';
import { SessionsCard } from '@/components/account/SessionsCard';
import { useSwitchLanguage } from '@/components/layout/LanguageSwitcher';

/** Up to two initials from the display name, else the email's first letter. */
function initials(user: SessionUser): string {
  const n = (user.full_name ?? '').trim();
  if (n) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return (user.email[0] ?? '?').toUpperCase();
}

/** Self-service account page — owns the useAccount hooks; the cards are pure. */
/** A refused request names its reason, as the IdP words it (the demo's read-only profile, a field it
 *  takes no value for); a server failure names nothing the person can act on. */
function serverReason(error: unknown): string | undefined {
  return error instanceof ApiClientError && error.status < 500 ? error.message : undefined;
}

export default function AccountPage() {
  const tc = useChrome();
  const dialog = useDialogHost();
  const user = useSessionStore((s) => s.user);
  const languages = useSessionStore((s) => s.languages);
  const switchLanguage = useSwitchLanguage();
  const locale = useSessionStore((s) => s.locale);
  const defaultCurrency = useSessionStore((s) => s.settings?.default_currency);
  const setLocaleFormat = useSessionStore((s) => s.setLocaleFormat);
  const resetLocale = useSessionStore((s) => s.resetLocale);

  const profileM = useProfileUpdate();
  const passwordM = usePasswordChange();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const [pwError, setPwError] = useState<string | undefined>();
  const [pwResetSignal, setPwResetSignal] = useState(0);
  const [regionSaving, setRegionSaving] = useState(false);
  const [regionError, setRegionError] = useState<string | undefined>();

  if (!user) return null;

  const onSaveProfile = async (body: Parameters<typeof profileM.mutate>[0]) => {
    const ok = await dialog.confirm({
      title: tc('ui.action.confirmSaveTitle'),
      message: tc('ui.action.confirmSaveBody'),
      confirmLabel: tc('ui.action.save'),
    });
    if (!ok) return;
    // Language is driven by the LOCAL stored locale (boot resolves it via
    // Accept-Language) — applying it here is what makes the change take effect +
    // survive a reload. The /auth/profile write persists it server-side too.
    if (body.language && body.language !== (user.language ?? undefined)) switchLanguage(body.language);
    profileM.mutate(body, {
      onSuccess: () => {
        dialog.toast(tc('ui.account.profile.saved'), 'success');
        // A cleared language leaves this device's own pick in force; forget it too.
        if (body.language === '') {
          resetLocale().catch((e: unknown) =>
            dialog.toast(
              e instanceof TranslationsLoadError
                ? tc('ui.lang.textsNotLoaded', {
                    language: languages.find((l) => l.code === e.language)?.native_name ?? e.language,
                  })
                : tc('ui.status.somethingWrong'),
              'error',
            ),
          );
        }
      },
    });
  };

  const onSaveRegion = async (formatLocale: string | null, timezone: string | null) => {
    const ok = await dialog.confirm({
      title: tc('ui.action.confirmSaveTitle'),
      message: tc('ui.action.confirmSaveBody'),
      confirmLabel: tc('ui.account.region.save'),
    });
    if (!ok) return;
    setRegionError(undefined);
    setRegionSaving(true);
    try {
      await setLocaleFormat(formatLocale, timezone);
      dialog.toast(tc('ui.account.region.saved'), 'success');
    } catch {
      setRegionError(tc('ui.status.somethingWrong'));
    } finally {
      setRegionSaving(false);
    }
  };

  const onChangePassword = async (body: ChangePasswordRequest) => {
    const ok = await dialog.confirm({
      title: tc('ui.action.confirmSaveTitle'),
      message: tc('ui.action.confirmSaveBody'),
      confirmLabel: tc('ui.account.password.submit'),
    });
    if (!ok) return;
    setPwError(undefined);
    passwordM.mutate(body, {
      onSuccess: () => {
        setPwResetSignal((n) => n + 1); // clear the password fields
        dialog.toast(tc('ui.account.password.changed'), 'success');
      },
      onError: (e) => {
        // The IdP returns 401 invalid_current_password → bind to the current-password field.
        if (e instanceof ApiClientError && e.status === 401) setPwError(tc('ui.account.password.currentInvalid'));
        else setPwError(tc('ui.status.somethingWrong'));
      },
    });
  };

  const onRevoke = async (sid: string) => {
    const ok = await dialog.confirm({
      title: tc('ui.account.sessions.revokeConfirmTitle'),
      message: tc('ui.account.sessions.revokeConfirmBody'),
      confirmLabel: tc('ui.account.sessions.revoke'),
      danger: true,
    });
    if (ok)
      revoke.mutate(sid, {
        onError: (e) => dialog.toast(tc('ui.account.sessions.revokeFailed', { error: e.message }), 'error'),
      });
  };

  const onRevokeOthers = async () => {
    const ok = await dialog.confirm({
      title: tc('ui.account.sessions.revokeOthersConfirmTitle'),
      message: tc('ui.account.sessions.revokeOthersConfirmBody'),
      confirmLabel: tc('ui.account.sessions.revokeOthers'),
      danger: true,
    });
    if (ok)
      revokeOthers.mutate(undefined, {
        onError: (e) => dialog.toast(tc('ui.account.sessions.revokeOthersFailed', { error: e.message }), 'error'),
      });
  };

  return (
    <div className="w-full space-y-4">
      <h1 className="text-h1 font-display text-textMain">{tc('ui.account.title')}</h1>

      <Card>
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-subtle text-base font-semibold text-textMain"
          >
            {initials(user)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-textMain">{user.full_name || user.email}</p>
            <p className="truncate text-sm text-textMuted">{user.email}</p>
          </div>
          {user.roles.length > 0 && (
            <div className="ml-auto flex flex-wrap justify-end gap-1.5">
              {user.roles.slice(0, 3).map((r) => (
                <Badge key={r} variant="pill" color="neutral">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      <ProfileCard
        user={user}
        languages={languages}
        onSave={onSaveProfile}
        saving={profileM.isPending}
        error={profileM.isError ? (serverReason(profileM.error) ?? tc('ui.status.somethingWrong')) : undefined}
      />
      <RegionCard
        formatLocale={locale?.format_locale}
        timezone={locale?.timezone}
        currency={defaultCurrency ?? undefined}
        onSave={onSaveRegion}
        saving={regionSaving}
        error={regionError}
      />
      <PasswordCard
        onSubmit={onChangePassword}
        submitting={passwordM.isPending}
        currentPasswordError={pwError}
        resetSignal={pwResetSignal}
      />
      {sessions.isError ? (
        <div className="space-y-2">
          <ErrorBlock title={tc('ui.account.sessions.loadFailed')} detail={sessions.error.message} />
          <Button type="button" variant="secondary" onClick={() => void sessions.refetch()}>
            {tc('ui.action.reload')}
          </Button>
        </div>
      ) : (
        <SessionsCard
          sessions={sessions.data ?? []}
          loading={sessions.isPending}
          onRevoke={onRevoke}
          onRevokeOthers={onRevokeOthers}
          busy={revoke.isPending || revokeOthers.isPending}
        />
      )}
    </div>
  );
}
