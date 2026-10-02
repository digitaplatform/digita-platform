/**
 * Where a page may load a tenant's branding image from: a path of the app's own, or an image
 * carried inline. Every other address, another host, a protocol-relative one or other inline data,
 * is refused, because every visitor's page would load it.
 */

/** URL path and query characters only, so no quote, parenthesis, backslash or space can end the
 *  address where a page writes it and add another. */
const APP_PATH = /^\/(?!\/)[A-Za-z0-9\-._~%!$&*+,;=:@/?]*$/;

/** Base64 only: its alphabet holds none of those characters either. */
const INLINE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

/** The longest inline image accepted, since a page carries it on every load. */
export const INLINE_IMAGE_MAX_LENGTH = 256 * 1024;

/** Whether a path climbs out of where it is put: a ".." segment, also percent-encoded, which a
 *  browser resolves, or an encoded "/" or "\", which a proxy may decode into a separator before it
 *  routes. Under a tenant's one host either would reach another app's path. */
function climbs(path: string): boolean {
  const route = path.split("?")[0]!;
  if (/%2f|%5c/i.test(route)) return true;
  return route.split("/").some((segment) => segment.toLowerCase().replaceAll("%2e", ".") === "..");
}

/** How a branding image address loads: as a path of the app's own, inline, or not at all (null). */
export function brandingImageKind(value: string): "path" | "inline" | null {
  if (APP_PATH.test(value) && !climbs(value)) return "path";
  if (value.length <= INLINE_IMAGE_MAX_LENGTH && INLINE_IMAGE.test(value)) return "inline";
  return null;
}
