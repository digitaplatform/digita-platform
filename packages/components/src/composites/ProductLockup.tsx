import { cn } from '../lib/cn.js';

export interface ProductLockupProps {
  /** The family word, spelled lowercase: `digita`. */
  family: string;
  /** The product word, spelled lowercase: `platform`, `erp`, `buildproject`. */
  product: string;
  /** The accessible name of the whole lockup; the dot is decorative. */
  label?: string;
  className?: string;
}

/**
 * The family lockup, `family`, the dot, `product`, set in the display face at whatever font
 * size the surface gives it. Every measure is a ratio of the font size, the ratios of the digita
 * wordmark SVG the family started with: the dot is 0.286em wide, its center sits 0.267em above
 * the baseline, and 0.143em of air stands on both sides of it. The dot is the primary accent
 * (the signature's `accent` anchors that ramp at step 600) and glows only in dark mode.
 * The dot appears nowhere but here: never in running text, never on the parent brand simetrix.
 */
export function ProductLockup({ family, product, label, className }: ProductLockupProps) {
  return (
    <span
      role="img"
      aria-label={label ?? `${family} ${product}`}
      data-testid="brand-lockup"
      className={cn('inline whitespace-nowrap font-display font-semibold leading-none tracking-[-0.03em] text-textMain', className)}
    >
      {family}
      <span
        aria-hidden="true"
        data-testid="brand-lockup-dot"
        className="mx-[0.143em] inline-block h-[0.286em] w-[0.286em] rounded-full bg-primary-600 align-[0.124em] dark:shadow-[0_0_8px_var(--color-primary-600)]"
      />
      {product}
    </span>
  );
}

/**
 * The product word a name spells inside a family: the family word and what separates it are
 * dropped, the rest is lowercased and joined (`Digita Platform` → `platform`, `ERP` → `erp`,
 * `digita ● cloud` → `cloud`). A name that is the family word alone names the platform itself.
 */
export function productWord(name: string, family: string): string {
  const rest = name
    .toLowerCase()
    .replace(new RegExp(`^\\s*${family}\\b`), '')
    .replace(/[\s●·•._-]+/g, '')
    .trim();
  return rest || 'platform';
}
