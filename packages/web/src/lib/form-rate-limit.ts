/**
 * Counts the sends of each address inside a sliding window and holds an address in memory for
 * that window and not longer: every recorded send leaves on its own timer, without another
 * request, which is what the privacy page promises about the visitor's address.
 */
// ponytail: in-memory, per process: a restart forgets it and each replica counts on its own, so
// the real ceiling is `limit` per window per replica. Move it to a shared store (Redis) once the
// site runs more than one replica or sees real abuse.
export class FormRateLimit {
  private readonly sends = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts one send of this address for the length of the window. */
  recordSend(address: string): void {
    this.sends.set(address, (this.sends.get(address) ?? 0) + 1);
    setTimeout(() => this.forget(address), this.windowMs).unref();
  }

  /** Whether the address sent more than the limit inside the window. */
  isOverLimit(address: string): boolean {
    return (this.sends.get(address) ?? 0) > this.limit;
  }

  /** Whether the address is held in memory right now: the observation point for the privacy claim. */
  remembers(address: string): boolean {
    return this.sends.has(address);
  }

  // One timer per recorded send, each for the whole window, so a firing timer always retires
  // exactly one send and the count needs no timestamps.
  private forget(address: string): void {
    const rest = (this.sends.get(address) ?? 0) - 1;
    if (rest > 0) this.sends.set(address, rest);
    else this.sends.delete(address);
  }
}
