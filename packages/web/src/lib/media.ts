import { getConfig } from "@/config/env";

/**
 * Build a browser-loadable URL for engine media. A File reference is an id served
 * by the engine's public file route; absolute URLs and root-relative paths pass
 * through unchanged. The engine origin reachable from the browser comes from
 * strict runtime config (PUBLIC_ENGINE_URL); "" = same-origin via the ingress.
 * Rendered server-side (block components), so reading server config is fine.
 */
export function mediaUrl(ref: string | undefined | null): string {
  if (!ref) return "";
  if (/^https?:\/\//.test(ref) || ref.startsWith("/")) return ref;
  return `${getConfig().publicEngineUrl}/api/v1/public/file/${ref}`;
}
