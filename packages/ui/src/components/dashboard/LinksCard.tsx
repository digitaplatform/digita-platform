import type { ReactNode } from 'react';
import type { LinksCard as LinksCardDef } from '@digitaplatform/shared';
import { CardShell } from './CardShell';

interface LinksCardProps {
  card: LinksCardDef;
  icon?: ReactNode;
  onNavigate: (to: string) => void;
}

const linkClass =
  'block rounded px-2 py-1.5 text-sm text-primary-600 dark:text-primary-400 hover:bg-subtle hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * Pure links tile. Each entry routes IN-app via onNavigate (`to`) or opens an
 * external target (`href`, new tab). An entry with neither is dropped loud-free at
 * the contract layer (workspace-schema requires non-empty links); a malformed entry
 * with no destination renders as inert text rather than a broken link.
 */
export function LinksCard({ card, icon, onNavigate }: LinksCardProps) {
  return (
    <CardShell label={card.label} icon={icon} width={card.width} status="ready">
      <ul className="-mx-2 flex flex-col">
        {card.links.map((link, i) => (
          <li key={i}>
            {link.to ? (
              <button type="button" onClick={() => onNavigate(link.to!)} className={`${linkClass} w-full text-left`}>
                {link.label}
              </button>
            ) : link.href ? (
              <a href={link.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {link.label}
              </a>
            ) : (
              <span className="block px-2 py-1.5 text-sm text-textMuted">{link.label}</span>
            )}
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
