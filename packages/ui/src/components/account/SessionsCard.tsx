import { MonitorSmartphone, LogOut } from 'lucide-react';
import { Badge, Button, Card, cn, IconButton } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import type { SessionSummary } from '@/services/account';

/**
 * Active-sessions list. PURE: data + callbacks only — the AccountPage owns
 * useSessions + the revoke mutations. A session whose status ≠ 'Active' renders
 * with muted/inactive styling. `busy` disables the controls during a mutation.
 * Revoking the current session logs you out (the page surfaces the hint).
 */
export interface SessionsCardProps {
  sessions: SessionSummary[];
  loading: boolean;
  onRevoke: (sid: string) => void;
  onRevokeOthers: () => void;
  busy: boolean;
}

export function SessionsCard({ sessions, loading, onRevoke, onRevokeOthers, busy }: SessionsCardProps) {
  const tc = useChrome();

  return (
    <Card>
      <div className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-subtle text-textMuted">
              <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-textMain">{tc('ui.account.sessions.title')}</h2>
              <p className="mt-0.5 text-sm text-textMuted">{tc('ui.account.sessions.hint')}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onRevokeOthers}
            disabled={busy || sessions.length <= 1}
          >
            {tc('ui.account.sessions.revokeOthers')}
          </Button>
        </header>

        {loading ? (
          <p className="py-6 text-center text-sm text-textMuted">{tc('ui.status.loading')}</p>
        ) : sessions.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-textMuted">
            {tc('ui.account.sessions.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {sessions.map((s) => {
              const active = s.status === 'Active';
              return (
                <li
                  key={s.sessionId}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-3 py-3',
                    !active && 'opacity-60',
                  )}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-textMain">
                        {s.user_agent || tc('ui.account.sessions.unknownDevice')}
                      </span>
                      <Badge variant="pill" color={active ? 'success' : 'neutral'}>
                        {active ? tc('ui.account.sessions.active') : tc('ui.account.sessions.inactive')}
                      </Badge>
                    </div>
                    <p className="text-xs text-textMuted">
                      {[s.ip_address, s.created_at].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <IconButton
                    label={tc('ui.account.sessions.revoke')}
                    variant="danger"
                    onClick={() => onRevoke(s.sessionId)}
                    disabled={busy}
                    icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-textMuted">{tc('ui.account.sessions.currentNote')}</p>
      </div>
    </Card>
  );
}
