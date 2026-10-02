import { brandingImageKind } from '@digitaplatform/shared';

/**
 * The path this app is served under on the tenant's one host (e.g. `/erp`). The ingress strips it
 * before nginx and the engine, so they keep serving their root; only the browser has to put the
 * app's own root paths under it.
 *
 * Resolution: window.__APP_BASE_PATH__, written into /env.js by the container entrypoint
 * (docker/app-env.sh) from the required APP_BASE_PATH env. The dev env.js leaves it empty: the dev
 * server serves the app at the root.
 */
const injected =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, unknown>).__APP_BASE_PATH__ as string | undefined)
    : undefined;

export const APP_BASE_PATH: string = (injected ?? '').replace(/\/+$/, '');

/**
 * A root path of this app — an engine call `/api/v1/...`, the plugin inventory, a file URL the
 * engine stored in a document — under the app's base path. An absolute URL, a protocol-relative
 * URL or a relative path is returned unchanged.
 */
export function appUrl(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') ? `${APP_BASE_PATH}${path}` : path;
}

/**
 * A tenant's branding image (logo, background, favicon) as an address this page may load: a path
 * of the app's own under its base path, an inline image as it is, and none for any other address,
 * which every visitor's page would request from another host.
 */
export function brandingImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const kind = brandingImageKind(value);
  if (kind === 'path') return appUrl(value);
  return kind === 'inline' ? value : undefined;
}
