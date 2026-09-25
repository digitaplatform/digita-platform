import { cn } from '../lib/cn.js';

export interface BrandMarkProps {
  /** The name shown beside the mark. */
  name: string;
  /** The tenant's own logo (a URL the caller resolved); it always wins. */
  logoUrl?: string;
  /** Whether the tenant set `name` itself: a custom name renders as text, never
   *  under a signature wordmark that spells another brand. */
  nameIsCustom?: boolean;
  /** The active signature's inline SVGs: `monogram` (currentColor, painted with the
   *  accent) and the wide `wordmark` lockup. */
  signature?: { monogram?: string; wordmark?: string };
  /** Let the name (or the wordmark) take the row's free space, as in a side rail. */
  fill?: boolean;
}

/**
 * The brand in the chrome, with one precedence everywhere: the signature's
 * wordmark lockup when the tenant set neither a logo nor a name; otherwise the
 * tenant's logo, else the signature's monogram, else the name's initial on a
 * primary tile — each followed by the name.
 */
export function BrandMark({ name, logoUrl, nameIsCustom = false, signature, fill = false }: BrandMarkProps) {
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
