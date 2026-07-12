import { cn } from '../lib/cn.js';

/** Pulse placeholder shown while content loads. Size it via `className`. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-subtle', className)} aria-hidden="true" />;
}
