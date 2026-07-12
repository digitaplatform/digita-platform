import { useId, useState } from 'react';
import { IdCard } from 'lucide-react';
import { Button, Card, Input, Select } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import type { SessionUser, BootLanguage } from '@/types';
import type { UpdateProfileRequest } from '@/services/account';

/**
 * Profile editor (full_name + language). PURE: data + callbacks only — the
 * AccountPage owns the useProfileUpdate hook and passes `saving`/`error`.
 * Languages come from /boot.available_languages (props, never fetched here).
 */
export interface ProfileCardProps {
  user: SessionUser;
  languages: BootLanguage[];
  onSave: (body: UpdateProfileRequest) => void;
  saving: boolean;
  /** Server-level failure surfaced by the page (calm inline alert). */
  error?: string;
}

export function ProfileCard({ user, languages, onSave, saving, error }: ProfileCardProps) {
  const tc = useChrome();
  const nameId = useId();
  const langId = useId();
  const langLabelId = useId();
  const errId = useId();

  const [fullName, setFullName] = useState(user.full_name ?? '');
  const [language, setLanguage] = useState(user.language ?? '');

  const dirty = fullName.trim() !== (user.full_name ?? '').trim() || language !== (user.language ?? '');

  const langOptions = [
    { value: '', label: tc('ui.account.profile.languageDefault') },
    ...languages.map((l) => ({
      value: l.code,
      label: `${l.flag_emoji ? `${l.flag_emoji} ` : ''}${l.native_name}`,
    })),
  ];

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!dirty || saving) return;
    onSave({
      full_name: fullName.trim() === '' ? undefined : fullName.trim(),
      language: language === '' ? undefined : language,
    });
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4" aria-describedby={error ? errId : undefined}>
        <header className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-subtle text-textMuted">
            <IdCard className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-textMain">{tc('ui.account.profile.title')}</h2>
            <p className="mt-0.5 text-sm text-textMuted">{tc('ui.account.profile.hint')}</p>
          </div>
        </header>

        {error && (
          <div id={errId} role="alert" className="rounded-md bg-error-light p-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-sm font-medium text-textMain">{tc('ui.account.profile.email')}</label>
          <Input value={user.email} readOnly disabled aria-label={tc('ui.account.profile.email')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={nameId} className="block text-sm font-medium text-textMain">
              {tc('ui.account.profile.fullName')}
            </label>
            <Input
              id={nameId}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={tc('ui.account.profile.fullNamePlaceholder')}
              disabled={saving}
            />
          </div>

          <div className="space-y-1">
            <label id={langLabelId} htmlFor={langId} className="block text-sm font-medium text-textMain">
              {tc('ui.account.profile.language')}
            </label>
            <Select
              id={langId}
              aria-labelledby={langLabelId}
              value={language}
              onChange={setLanguage}
              disabled={saving}
              options={langOptions}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!dirty || saving}>
            {tc('ui.account.profile.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
