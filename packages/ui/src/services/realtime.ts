import { queryClient } from '@/lib/query-client';
import { qkPrefix } from '@/lib/query-keys';

/**
 * Live-sync client (one per tab). After a committed write on the engine, the WS
 * gateway pushes a `{type:'change', entity, name, op}` event to every client that
 * has SUBSCRIBED to that entity (i.e. currently has it open) and may read it. We
 * react by invalidating the entity's cached queries → TanStack refetches the
 * mounted list/record → the view updates to the latest. The refetch stays
 * permission-gated by the resource API, so the socket itself carries no document
 * data (only entity + id + op). The acting tab is NOT excluded: its own open
 * views get the echo too (idempotent — a redundant invalidation is harmless).
 *
 * The session token rides the httpOnly cookie on the upgrade handshake (same
 * origin), so no token is read into JS. Reconnects with capped backoff; the
 * desired subscription set is replayed on every (re)connect. Single-tab scope —
 * cross-replica fan-out is the engine's concern (out of scope for v1).
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  /** entity → refcount, so overlapping subscribers (e.g. a dashboard card + a
   *  list) coexist; the union is what we send to the server. */
  private desired = new Map<string, number>();
  private path = '/ws';
  private started = false;
  private stopped = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Open the connection (idempotent). `path` comes from /boot (engine WS_PATH). */
  start(path: string): void {
    this.path = path || '/ws';
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.open();
  }

  /** Close + forget everything (on logout). */
  stop(): void {
    this.started = false;
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.desired.clear();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  /**
   * Declare interest in one or more entities while the caller is mounted.
   * Returns an unsubscribe to call on unmount. The server's subscription set is
   * always the current union of all active subscribers.
   */
  subscribe(entities: string[]): () => void {
    const added = entities.filter((e) => typeof e === 'string' && e);
    for (const e of added) this.desired.set(e, (this.desired.get(e) ?? 0) + 1);
    this.sendSubscribe();
    return () => {
      for (const e of added) {
        const n = (this.desired.get(e) ?? 0) - 1;
        if (n <= 0) this.desired.delete(e);
        else this.desired.set(e, n);
      }
      this.sendSubscribe();
    };
  }

  private url(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${this.path}`;
  }

  private open(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: { type?: string; entity?: unknown };
      try {
        msg = JSON.parse(String(ev.data)) as { type?: string; entity?: unknown };
      } catch {
        return;
      }
      // The server acks the handshake with `ready`; (re)send our subscriptions then.
      if (msg.type === 'ready') {
        this.sendSubscribe();
        return;
      }
      if (msg.type === 'change' && typeof msg.entity === 'string') {
        void queryClient.invalidateQueries({ queryKey: qkPrefix.entity(msg.entity) });
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    };
    // An error is always followed by close → reconnect is handled there. Swallow
    // so it never bubbles to window.onerror.
    ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.started) return;
    if (this.reconnectTimer) return;
    // 1s, 2s, 4s … capped at 30s. Indefinite (the engine may restart mid-session).
    const delay = Math.min(30_000, 1_000 * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private sendSubscribe(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'subscribe', entities: [...this.desired.keys()] }));
  }
}

export const realtime = new RealtimeClient();
