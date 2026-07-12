import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { jobsAlive, jobsRole } from '@/services/jobs';
import { UserCircle, Settings, Palette, LogOut, ChevronDown, Timer } from 'lucide-react';
import { Menu, MenuItem } from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Topbar account/settings dropdown. Items:
 *   - My Account            (/account)         — always
 *   - Platform Settings     (/Setting)         — Admin only
 *   - Appearance & Branding (/BrandingSetting) — Admin only
 *   - Sign out              (logout())
 *
 * Admin gating is UX only — the engine still server-guards those routes (a
 * non-admin deep-link gets a 403 via the generic RecordPage). Built on the
 * generic Menu primitive (open/close, Escape, click-outside, keyboard nav). NO
 * network of its own (reads session state + navigates / logs out).
 */

const ADMIN_ROLE = 'Administrator';

interface MenuEntry {
  key: string;
  label: string;
  icon: typeof UserCircle;
  to?: string; // navigate target
  action?: () => void; // non-nav action (sign out)
  danger?: boolean;
}

export function AppMenu() {
  const tc = useChrome();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const hasRole = useSessionStore((s) => s.hasRole);
  const logout = useSessionStore((s) => s.logout);

  const isAdmin = hasRole(ADMIN_ROLE);

  // Jobs satellite gate: entry exists only when the per-tenant service answers
  // its /health AND the user carries a jobs role (opt-in tenants only).
  const jobsRoleName = jobsRole((user?.roles as string[] | undefined) ?? []);
  const jobsUp = useQuery({
    queryKey: ['jobs-alive'],
    queryFn: jobsAlive,
    enabled: !!jobsRoleName,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const showJobs = !!jobsRoleName && jobsUp.data === true;

  const items: MenuEntry[] = [
    { key: 'account', label: tc('ui.menu.account'), icon: UserCircle, to: '/account' },
    ...(showJobs
      ? ([{ key: 'jobs', label: tc('ui.menu.jobs'), icon: Timer, to: '/_jobs' }] satisfies MenuEntry[])
      : []),
    ...(isAdmin
      ? ([
          { key: 'settings', label: tc('ui.menu.settings'), icon: Settings, to: '/Setting' },
          { key: 'branding', label: tc('ui.menu.branding'), icon: Palette, to: '/BrandingSetting' },
        ] satisfies MenuEntry[])
      : []),
    {
      key: 'signout',
      label: tc('ui.menu.signOut'),
      icon: LogOut,
      action: () => void logout(),
      danger: true,
    },
  ];

  return (
    <Menu
      label={tc('ui.menu.account')}
      align="end"
      panelClassName="w-60"
      triggerClassName="flex items-center gap-1 rounded-md p-1.5 text-textMuted transition-colors duration-base ease-smooth hover:bg-bgHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      trigger={
        <>
          <UserCircle className="h-5 w-5" />
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <>
          {(user?.full_name || user?.email) && (
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-sm font-medium text-textMain">
                {user?.full_name ?? user?.email}
              </p>
              {user?.full_name && <p className="truncate text-xs text-textMuted">{user.email}</p>}
            </div>
          )}
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <MenuItem
                key={item.key}
                danger={item.danger}
                icon={<Icon className="h-4 w-4" />}
                onSelect={() => {
                  close();
                  if (item.to) navigate(item.to);
                  else item.action?.();
                }}
              >
                {item.label}
              </MenuItem>
            );
          })}
        </>
      )}
    </Menu>
  );
}
