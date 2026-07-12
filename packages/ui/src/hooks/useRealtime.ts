import { useEffect } from 'react';
import { useSessionStore } from '@/stores/session';
import { realtime } from '@/services/realtime';

/**
 * Open the live-sync WebSocket while the authenticated shell is mounted — only
 * when the engine reports realtime enabled (`/boot`). Closes on unmount (logout
 * bounces to /login → the shell unmounts → the socket stops). Mount ONCE, at the
 * shell level.
 */
export function useRealtimeConnection(): void {
  const enabled = useSessionStore((s) => s.realtime?.enabled ?? false);
  const path = useSessionStore((s) => s.realtime?.path ?? '/ws');
  const status = useSessionStore((s) => s.status);
  useEffect(() => {
    if (status !== 'authenticated' || !enabled) return;
    realtime.start(path);
    return () => realtime.stop();
  }, [status, enabled, path]);
}

/**
 * Subscribe to live changes for one entity while a view (list/record) is mounted,
 * so other users' writes refresh this tab's cached queries. No-op when realtime
 * is off (the socket never opens, the subscription is simply never sent).
 */
export function useRealtimeEntity(entity: string | undefined): void {
  useEffect(() => {
    if (!entity) return;
    return realtime.subscribe([entity]);
  }, [entity]);
}
