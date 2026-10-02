import { brandingImageKind } from "@digitaplatform/shared";
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

/**
 * The tenant's branding logo as an address the site may draw: a path of the tenant's own or an
 * inline image, by the platform's one rule, and none for any other address, which every visitor's
 * page would request from another host. A block's image stays as its editor set it.
 */
export function brandingImageUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const kind = brandingImageKind(value);
  if (kind === "path") return mediaUrl(value);
  return kind === "inline" ? value : undefined;
}
