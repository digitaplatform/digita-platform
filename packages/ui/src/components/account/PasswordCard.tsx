import { useEffect, useId, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Card, Input } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import type { ChangePasswordRequest } from '@/services/account';

/**
 * Change-password form. PURE: data + callbacks only — the AccountPage owns the
 * usePasswordChange mutation. A 401 invalid_current_password is decoded by the
 * page and passed back as `currentPasswordError`, bound to the current-password
 * field. The confirm field is checked client-side (never sent to the server).
 */
export interface PasswordCardProps {
  onSubmit: (body: ChangePasswordRequest) => void;
  submitting: boolean;
  /** Server-side "wrong current password" message bound to the current field. */
  currentPasswordError?: string;
  /** Bump to clear the fields after a successful change (page-owned). */
  resetSignal?: number;
}

export function PasswordCard({ onSubmit, submitting, currentPasswordError, resetSignal }: PasswordCardProps) {
  const tc = useChrome();
  const curId = useId();
  const newId = useId();
  const confirmId = useId();
  const curErrId = useId();
  const confirmErrId = useId();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);

  // Clear all fields once the page signals a successful change.
  useEffect(() => {
    if (resetSignal === undefined || resetSignal === 0) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setConfirmTouched(false);
  }, [resetSignal]);

  const mismatch = confirmTouched && confirm !== '' && confirm !== next;
  const canSubmit =
    !submitting && current !== '' && next !== '' && confirm !== '' && next === confirm;

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setConfirmTouched(true);
    if (!canSubmit) return;
    onSubmit({ current_password: current, new_password: next });
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <header className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-subtle text-textMuted">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-textMain">{tc('ui.account.password.title')}</h2>
            <p className="mt-0.5 text-sm text-textMuted">{tc('ui.account.password.hint')}</p>
          </div>
        </header>

        <div className="space-y-1">
          <label htmlFor={curId} className="block text-sm font-medium text-textMain">
            {tc('ui.account.password.current')}
          </label>
          <Input
            id={curId}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={submitting}
            aria-invalid={currentPasswordError ? true : undefined}
            aria-describedby={currentPasswordError ? curErrId : undefined}
          />
          {currentPasswordError && (
            <p id={curErrId} role="alert" className="text-sm text-error">
              {currentPasswordError}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor={newId} className="block text-sm font-medium text-textMain">
            {tc('ui.account.password.new')}
          </label>
          <Input
            id={newId}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={confirmId} className="block text-sm font-medium text-textMain">
            {tc('ui.account.password.confirm')}
          </label>
          <Input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => setConfirmTouched(true)}
            disabled={submitting}
            aria-invalid={mismatch ? true : undefined}
            aria-describedby={mismatch ? confirmErrId : undefined}
          />
          {mismatch && (
            <p id={confirmErrId} role="alert" className="text-sm text-error">
              {tc('ui.account.password.mismatch')}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={submitting} disabled={!canSubmit}>
            {tc('ui.account.password.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
