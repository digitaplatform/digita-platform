/**
 * Tiny TTL cache for period documents.
 *
 * Period close-flags rarely flip during a transaction (they live on long-
 * lived calendar rows), so caching the recent lookups for a few seconds
 * cuts the read load on hot submit paths without giving up freshness.
 *
 * Keyed by `<period_entity>:<period_id>`. Only positive results are cached
 * (the "missing period" case stays uncached so a corrected fixture is
 * picked up immediately).
 */

interface Entry {
  doc: Record<string, unknown>;
  expiresAt: number;
}

export class PeriodCache {
  private map = new Map<string, Entry>();

  constructor(private ttlMs: number = 5_000) {}

  get(periodEntity: string, periodId: string): Record<string, unknown> | undefined {
    const key = `${periodEntity}:${periodId}`;
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.doc;
  }

  set(periodEntity: string, periodId: string, doc: Record<string, unknown>): void {
    this.map.set(`${periodEntity}:${periodId}`, {
      doc,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.map.clear();
  }

  /** Test-only: read the size without exposing the internal map. */
  size(): number {
    return this.map.size;
  }
}
