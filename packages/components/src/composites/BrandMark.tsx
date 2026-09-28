import { cn } from '../lib/cn.js';
import { ProductLockup, productWord } from './ProductLockup.js';

export interface BrandMarkProps {
  /** The name shown beside the mark. */
  name: string;
  /** The tenant's own logo (a URL the caller resolved); it always wins. */
  logoUrl?: string;
  /** Whether the tenant set `name` itself: a custom name renders as text, never
   *  under a signature wordmark that spells another brand. */
  nameIsCustom?: boolean;
  /** The active signature: its `id`, its lockup `family` (the family word of a lockup system,
   *  `digita`) and its inline SVGs, `monogram` (currentColor, painted with the accent) and the
   *  wide `wordmark` lockup. */
  signature?: { id?: string; family?: string; monogram?: string; wordmark?: string };
  /** Let the name (or the wordmark) take the row's free space, as in a side rail. */
  fill?: boolean;
}

/**
 * The brand in the chrome, with one precedence everywhere: the family lockup
 * (`digita ● erp`) when the signature has a lockup family and the name is the
 * family's or none was set; the signature's wordmark SVG when the tenant set
 * neither a logo nor a name; otherwise the tenant's logo, else the signature's
 * monogram, else the name's initial on a primary tile — each followed by the name.
 */
export function BrandMark({ name, logoUrl, nameIsCustom = false, signature, fill = false }: BrandMarkProps) {
  // ponytail: the digita signature package predates `Signature.family`; until the
  // published @digitaplatform/digita sets `family: 'digita'`, its id stands in.
  const family = signature?.family ?? (signature?.id === 'digita' ? 'digita' : undefined);
  // A custom name that spells the family ("Digita Platform") is the family's own and takes the
  // lockup; any other custom name renders as text, never under the family's mark.
  const lockup = family && !logoUrl && (!nameIsCustom || name.toLowerCase().startsWith(family));
  if (lockup) {
    return (
      <ProductLockup
        family={family}
        product={productWord(name, family)}
        label={name}
        className={cn('text-[22px]', fill && 'flex-1')}
      />
    );
  }

  const wordmark = !logoUrl && !nameIsCustom ? signature?.wordmark : undefined;
  if (wordmark) {
    return (
      <div
        role="img"
        aria-label={name}
        data-testid="brand-wordmark"
        className={cn('h-7 text-textMain [&>svg]:h-full [&>svg]:w-auto', fill && 'flex-1')}
        dangerouslySetInnerHTML={{ __html: wordmark }}
      />
    );
  }

  const mark = logoUrl ? (
    <img src={logoUrl} alt="" className="h-7 w-7 shrink-0 rounded" />
  ) : signature?.monogram ? (
    <div
      aria-hidden="true"
      className="h-7 w-7 shrink-0 text-primary-600 [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: signature.monogram }}
    />
  ) : (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary-600 text-sm font-bold text-onPrimary">
      {name.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <>
      {mark}
      <span className={cn('truncate text-sm font-semibold text-textMain', fill && 'flex-1')}>{name}</span>
    </>
  );
}
