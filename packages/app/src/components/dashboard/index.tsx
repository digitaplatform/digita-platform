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
  /** The entity the section reads, from the view definition; unset when that failed to load. */
  entity?: string;
}

/** The params a view-bound card sends its view. */
export type ViewParams = Record<string, string | number | boolean>;

/** The Page-supplied resolver: maps a card's (view, section, params) to its section data.
 *  `view` may be undefined (the card inherits the workspace default_view, already
 *  merged by the Page). For shortcut/links cards (no view) it is not called. */
export type CardResolve = (
  view: string | undefined,
  section: string,
  params?: ViewParams,
) => ResolvedSection;

/** Grid width → literal Tailwind col-span class, written whole so the Tailwind scan keeps it.
 *  The responsive grid lives in DashboardPage (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`);
 *  a width only widens a card at the three-column breakpoint, so a phone always stacks. */
const WIDTH_SPAN: Record<1 | 2 | 3, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
};

/**
 * The col-span class of the grid item that holds `card`. It belongs on the grid's own child:
 * on the card inside that child a span does nothing. A chart or a list needs room to be read,
 * so it is two columns wide unless it names its width; any other card is one.
 */
export function cardSpan(card: WorkspaceCard): string {
  const needsRoom = card.kind === 'chart' || card.kind === 'list';
  return WIDTH_SPAN[card.width ?? (needsRoom ? 2 : 1)];
}

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
      const r = resolve(card.view, card.section, card.params);
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
      const r = resolve(card.view, card.section, card.params);
      return (
        <ChartCard
          card={card}
          icon={icon}
          status={shellStatus(card, r)}
          error={r.message?.text}
          data={r.data}
          entity={r.entity}
        />
      );
    }
    case 'list': {
      const r = resolve(card.view, card.section, card.params);
      return (
        <ListCard
          card={card}
          icon={icon}
          status={shellStatus(card, r)}
          error={r.message?.text}
          data={r.data}
          entity={r.entity}
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
