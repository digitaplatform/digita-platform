import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import type { ViewResult, ResponseMessage } from '@digitaplatform/shared';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';
import { useWorkspaceCatalog } from '@/hooks/useWorkspaceCatalog';
import { useWorkspace } from '@/hooks/useWorkspace';
import { getView } from '@/services/resource';
import { qk } from '@/lib/query-keys';
import { ApiClientError } from '@/lib/errors';
import { renderCard, type CardResolve, type ResolvedSection } from '@/components/dashboard';
import { ErrorBlock, EmptyState } from '@/components/status';
import { CardsSkeleton } from '@digitaplatform/components';

interface ViewQueryData {
  result: ViewResult | null;
  messages: ResponseMessage[];
}

/** Resolve unanchored deep-link tokens client-side ($user.* / $now). An unresolved
 *  $token → dev error + null (drop the nav rather than route to junk). */
function resolveTokens(to: string, user: Record<string, unknown> | null): string | null {
  const out = to
    .replace(/\$user\.(\w+)/g, (_, k: string) => String(user?.[k] ?? ''))
    .replace(/\$now/g, new Date().toISOString().slice(0, 10));
  if (out.includes('$')) {
    if (import.meta.env.DEV) console.error('[dashboard] unresolved deep-link token:', to);
    return null;
  }
  return out;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const override = sp.get('workspace') ?? undefined;
  const user = useSessionStore((s) => s.user) as unknown as Record<string, unknown> | null;
  const defaultWorkspace = useSessionStore((s) => s.default_workspace);
  const tc = useChrome();

  const catalog = useWorkspaceCatalog();

  // Fallback ladder: ?workspace override (must be visible) → boot default (if visible)
  // → highest-priority visible → none.
  const { wsId, notFound } = useMemo(() => {
    const visibleIds = new Set(catalog.visible.map((w) => w._id));
    if (override) {
      return visibleIds.has(override) ? { wsId: override, notFound: false } : { wsId: null, notFound: true };
    }
    if (defaultWorkspace && visibleIds.has(defaultWorkspace)) {
      return { wsId: defaultWorkspace, notFound: false };
    }
    if (defaultWorkspace && import.meta.env.DEV) {
      console.error('[dashboard] default_workspace not in the visible set:', defaultWorkspace);
    }
    return { wsId: catalog.visible[0]?._id ?? null, notFound: false };
  }, [override, defaultWorkspace, catalog.visible]);

  const ws = useWorkspace(wsId ?? undefined);

  // Distinct effective view names (card.view ?? workspace.default_view, + shortcut counts).
  const viewNames = useMemo(() => {
    const cards = ws.data?.cards ?? [];
    const names = new Set<string>();
    for (const c of cards) {
      if (c.kind === 'number' || c.kind === 'chart' || c.kind === 'list') {
        const v = c.view ?? ws.data?.default_view;
        if (v) names.add(v);
      } else if (c.kind === 'shortcut' && c.count_view) {
        names.add(c.count_view);
      }
    }
    return [...names];
  }, [ws.data]);

  const viewQueries = useQueries({
    queries: viewNames.map((name) => ({
      queryKey: qk.view(name, null),
      enabled: !!name,
      staleTime: 30_000,
      queryFn: async (): Promise<ViewQueryData> => {
        const res = await getView(name);
        if (!res.success) {
          throw new ApiClientError(res.error?.detail ?? 'View failed', res.status_code ?? 500, res);
        }
        return { result: res.data, messages: res.messages ?? [] };
      },
    })),
  });

  const byView = useMemo(() => {
    const m = new Map<string, (typeof viewQueries)[number]>();
    viewNames.forEach((n, i) => m.set(n, viewQueries[i]!));
    return m;
  }, [viewNames, viewQueries]);

  const resolve: CardResolve = (view, section) => {
    const effective = view ?? ws.data?.default_view;
    if (!effective) {
      return { status: 'error', data: null, message: { text: tc('ui.dashboard.cardError'), type: 'error', show: true } };
    }
    const q = byView.get(effective);
    if (!q || q.isPending) return { status: 'loading', data: null };
    if (q.isError) {
      return { status: 'error', data: null, message: { text: tc('ui.dashboard.cardError'), type: 'error', show: true } };
    }
    const sections = q.data?.result?.sections ?? {};
    const message = (q.data?.messages ?? []).find((m) => m.path === `/sections/${section}`);
    const result: ResolvedSection = {
      status: message ? 'locked' : 'ready',
      data: section in sections ? sections[section]! : null,
      message,
    };
    return result;
  };

  const go = (to: string) => {
    const resolved = resolveTokens(to, user);
    if (resolved) navigate(resolved);
  };

  if (catalog.isLoading) return <CardsSkeleton cards={4} />;
  if (notFound) return <ErrorBlock title={tc('ui.dashboard.notFound')} detail={override} />;

  if (wsId) {
    if (ws.isLoading) return <CardsSkeleton cards={4} />;
    if (ws.isError) {
      return (
        <ErrorBlock
          title={tc('ui.dashboard.cardError')}
          detail={ws.error instanceof Error ? ws.error.message : undefined}
        />
      );
    }
    const cards = ws.data?.cards ?? [];
    return (
      <div className="space-y-4">
        <h1 className="text-h1 font-display text-textMain">{ws.data?.name ?? tc('ui.dashboard.title')}</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <div key={card.id}>{renderCard(card, resolve, go)}</div>
          ))}
        </div>
      </div>
    );
  }

  // No Workspace resolved → a neutral empty state. We deliberately do NOT fall back
  // to a grid of every navigable entity (that's noise, not a dashboard) — the
  // dashboard stays empty until a Workspace is configured/designed.
  return (
    <EmptyState
      title={tc('ui.dashboard.empty')}
      hint={tc('ui.dashboard.emptyHint')}
      // Platform-chrome glyph for the dashboard's own empty state (not an app concept).
      icon={<LayoutDashboard aria-hidden="true" />}
    />
  );
}
