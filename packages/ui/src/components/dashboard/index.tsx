import type { ReactNode } from 'react';
import type {
  ResponseMessage,
  ViewSectionData,
  WorkspaceCard,
} from '@digitaplatform/shared';
import { CardShell, type CardStatus } from './CardShell';
import { NumberCard } from './NumberCard';
import { ChartCard } from './ChartCard';
import { ListCard } from './ListCard';
import { ShortcutCard } from './ShortcutCard';
import { LinksCard } from './LinksCard';
import { cardIcon } from './card-icon';

export { CardShell } from './CardShell';
export type { CardStatus } from './CardShell';
export { NumberCard } from './NumberCard';
export { ChartCard } from './ChartCard';
export { ListCard } from './ListCard';
export { ShortcutCard } from './ShortcutCard';
export { LinksCard } from './LinksCard';

/** What the DashboardPage hands back for one (view, section) lookup. `status`:
 *  loading → skeleton; ready → data; error → loud transport/view failure;
 *  locked → no permission on the section (calm by default). */
export interface ResolvedSection {
  status: 'loading' | 'ready' | 'error' | 'locked';
  data: ViewSectionData;
  message?: ResponseMessage;
}

/** The Page-supplied resolver: maps a card's (view, section) to its section data.
 *  `view` may be undefined (the card inherits the workspace default_view, already
 *  merged by the Page). For shortcut/links cards (no view) it is not called. */
export type CardResolve = (
  view: string | undefined,
  section: string,
) => ResolvedSection;

/**
 * Map a resolver result + the card's on_data_error policy to a CardShell status.
 * Loud errors are always loud. A locked/empty section is CALM by default; a card
 * may opt INTO loud-on-empty via on_data_error: 'error' (a conscious authoring
 * choice, e.g. "this KPI must always have data").
 */
function shellStatus(card: WorkspaceCard, r: ResolvedSection): CardStatus {
  if (r.status === 'loading') return 'loading';
  if (r.status === 'error') return 'error';
  if (r.status === 'locked') {
    return card.on_data_error === 'error' ? 'error' : 'locked';
  }
  return 'ready';
}

/**
 * The dashboard card DISPATCHER. Pure: the Page resolves each card's section data
 * (via `resolve`) and supplies a `navigate` callback; this picks the right pure card
 * component by `card.kind`. An unknown kind fails LOUD (red CardShell), never a
 * silent skip — app data drives the kind so a typo must surface.
 */
export function renderCard(
  card: WorkspaceCard,
  resolve: CardResolve,
  navigate: (to: string) => void,
): ReactNode {
  const icon = cardIcon(card.icon, 20);

  switch (card.kind) {
    case 'number': {
      const r = resolve(card.view, card.section);
      return (
        <NumberCard
          card={card}
          icon={icon}
          status={shellStatus(card, r)}
          error={r.message?.text}
          data={r.data}
          onNavigate={navigate}
        />
      );
    }
    case 'chart': {
      const r = resolve(card.view, card.section);
      return (
        <ChartCard
          card={card}
          icon={icon}
          status={shellStatus(card, r)}
          error={r.message?.text}
          data={r.data}
        />
      );
    }
    case 'list': {
      const r = resolve(card.view, card.section);
      return (
        <ListCard
          card={card}
          icon={icon}
          status={shellStatus(card, r)}
          error={r.message?.text}
          data={r.data}
          onNavigate={navigate}
        />
      );
    }
    case 'shortcut': {
      // Count is optional: only resolve when the card declares a count section.
      const countData =
        card.count_view || card.count_section
          ? resolve(card.count_view, card.count_section ?? '').data
          : undefined;
      return <ShortcutCard card={card} icon={icon} countData={countData} onNavigate={navigate} />;
    }
    case 'links':
      return <LinksCard card={card} icon={icon} onNavigate={navigate} />;
    default: {
      // FAIL LOUD: a card kind the dispatcher does not know — app/seed typo.
      const unknown = card as { kind?: string; label?: string };
      return (
        <CardShell
          label={unknown.label ?? 'Card'}
          status="error"
          error={`unknown card kind '${String(unknown.kind)}'`}
        />
      );
    }
  }
}
