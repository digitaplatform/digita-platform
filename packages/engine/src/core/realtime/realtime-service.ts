import type { UserContext } from "../permissions/types.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("realtime");

export type ChangeOp = "insert" | "update" | "delete";

/** Minimal socket surface (a `ws` WebSocket) — avoids a direct "ws" type dep. */
export interface RealtimeSocket {
  send(data: string): void;
  readyState: number;
}

export interface RealtimeClient {
  socket: RealtimeSocket;
  user: UserContext;
  /** Entities this client is currently viewing (set via a `subscribe` message). */
  subscriptions: Set<string>;
}

/** ws WebSocket.OPEN */
const OPEN = 1;

/**
 * In-process registry of authenticated WebSocket clients + a subscription-targeted
 * doc-change broadcaster (LIVE DATA SYNC, not just toasts). After a committed write
 * the resource layer calls `broadcast()`; the event reaches ONLY clients that have
 * SUBSCRIBED to the affected entity (i.e. currently have it open) AND may `select`
 * it. Those clients invalidate their cached queries → re-fetch → their list/record
 * updates to the latest. The re-fetch stays permission-gated by the resource API,
 * so no protected document data leaks through this channel (the event carries only
 * entity + id + op). The originator is NOT special-cased: their own open views
 * (incl. the acting tab) refresh too — idempotent.
 *
 * Single-replica scope: events fan out to clients on THIS engine instance. A
 * multi-replica deployment would need a shared bus (Redis pub/sub) — out of scope
 * for v1 (per-tenant instances are single/low-replica).
 */
export class RealtimeService {
  private clients = new Set<RealtimeClient>();

  constructor(private permissionChecker: PermissionChecker) {}

  add(socket: RealtimeSocket, user: UserContext): RealtimeClient {
    const client: RealtimeClient = { socket, user, subscriptions: new Set() };
    this.clients.add(client);
    return client;
  }

  remove(client: RealtimeClient): void {
    this.clients.delete(client);
  }

  /** Replace a client's subscription set with the entities it is currently viewing. */
  subscribe(client: RealtimeClient, entities: string[]): void {
    client.subscriptions = new Set(entities.filter((e) => typeof e === "string" && e));
  }

  get size(): number {
    return this.clients.size;
  }

  /** Non-blocking: fire-and-forget so a write response is never delayed. */
  broadcast(event: { entity: string; name: string; op: ChangeOp }): void {
    if (this.clients.size === 0) return;
    void this.fanout(event);
  }

  private async fanout(event: { entity: string; name: string; op: ChangeOp }): Promise<void> {
    const msg = JSON.stringify({ type: "change", entity: event.entity, name: event.name, op: event.op });
    for (const client of this.clients) {
      // Targeted: only clients viewing this entity, that are open and may read it.
      if (client.socket.readyState !== OPEN) continue;
      if (!client.subscriptions.has(event.entity)) continue;
      try {
        const { allowed } = await this.permissionChecker.hasPermission(client.user, event.entity, "select");
        if (allowed) client.socket.send(msg);
      } catch (err) {
        log.debug({ err: (err as Error).message, entity: event.entity }, "realtime send skipped");
      }
    }
  }
}
