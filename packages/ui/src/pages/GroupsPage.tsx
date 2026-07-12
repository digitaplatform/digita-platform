import { useState, useEffect } from 'react';
import { cn, EmptyState } from '@digitaplatform/components';
import { useTreeEntities } from '@/hooks/useTreeEntities';
import { TreeEditor } from '@/components/render/TreeEditor';
import { LoadingBlock } from '@/components/status';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * Master-data Groups — a dedicated, metadata-driven module that surfaces EVERY
 * entity declaring a `tree` config (article groups, customer/supplier groups,
 * chart of accounts, …) as a manageable hierarchy in ONE place, so it gets its
 * own menu point + permission gate instead of being buried in each entity's list
 * view. Zero entity-specific code: it enumerates tree entities and hands each to
 * the generic TreeEditor (which itself edits nodes in a modal, so the tree stays
 * in view).
 */
export default function GroupsPage() {
  const tc = useChrome();
  const { entities, isLoading } = useTreeEntities();
  const [selected, setSelected] = useState<string | null>(null);

  // Default to the first tree entity once the list resolves.
  useEffect(() => {
    if (!selected && entities.length) setSelected(entities[0]!.entity);
  }, [entities, selected]);

  if (isLoading) return <LoadingBlock />;

  return (
    <div className="space-y-5" data-testid="page-groups">
      <header>
        <p className="text-xs uppercase tracking-wide text-textMuted">{tc('ui.groups.eyebrow')}</p>
        <h1 className="text-h1 font-display text-textMain">{tc('ui.groups.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-textMuted">{tc('ui.groups.subtitle')}</p>
      </header>

      {entities.length === 0 ? (
        <EmptyState title={tc('ui.groups.emptyTitle')} hint={tc('ui.groups.emptyBody')} />
      ) : (
        <>
          {entities.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label={tc('ui.groups.title')}>
              {entities.map((e) => {
                const active = e.entity === selected;
                return (
                  <button
                    key={e.entity}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelected(e.entity)}
                    className={cn(
                      'rounded-btn px-3.5 py-1.5 text-sm font-medium transition-colors duration-base ease-smooth',
                      'focus-visible:outline-none focus-visible:shadow-focus',
                      active
                        ? 'bg-primary-600 text-onPrimary'
                        : 'bg-subtle text-textMain hover:bg-bgHover',
                    )}
                  >
                    {e.label}
                  </button>
                );
              })}
            </div>
          )}

          {(() => {
            const active = entities.find((e) => e.entity === selected) ?? entities[0]!;
            return (
              <TreeEditor
                key={active.entity}
                entity={active.entity}
                meta={active.meta}
                tree={active.meta.tree!}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}
