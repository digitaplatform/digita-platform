import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The ONE canonical class-name merge for the whole platform (was duplicated in
 * every frontend). tailwind-merge v3 already de-dupes the custom design tokens
 * correctly (e.g. `cn('bg-surface','bg-subtle') === 'bg-subtle'`), so no extend
 * config is needed.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
