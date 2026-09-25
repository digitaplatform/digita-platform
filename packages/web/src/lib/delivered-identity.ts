import {
  designFromSource,
  findPluginInventory,
  joinCompositionWithInventory,
  type PluginManifest,
} from "@digitaplatform/plugins";
import { CSRF_HEADER, findCookie, sessionCookieNames, type ApiResponse } from "@digitaplatform/shared";
import {
  bootIdentity,
  DESIGNS,
  getRuntimeDesign,
  getRuntimeSignature,
  loadDeliveredDesign,
  readPageIdentity,
  registerDeliveredSignature,
  resolveInitialDesign,
  resolveInitialSignature,
} from "@digitaplatform/theme";

/** Where the page finds a signed-in visitor's design and signature plugins. */
export interface DeliveredIdentitySources {
  /** The tenant's apps, asked in this order; each serves its composition under /<app>/. */
  apps: string[];
  /** The tenant IdP's public base URL, where an expired session is refreshed; null: none. */
  authUrl: string | null;
  /** The tenant's session cookie suffix (sessionCookieNames); null: the unsuffixed names. */
  authCookieSuffix: string | null;
}

/**
 * Bring the design and the signature a signed-in visitor chose in the app onto this page, the way
 * the app loads them: from the composition of the tenant's app, with the visitor's session, so the
 * app's entitlement check decides. Only a stored choice the page does not bundle is fetched. An
 * anonymous visitor gets no composition and keeps the default, as in the app before login. When a
 * delivered design or signature arrives, every identity layer is applied again in its order.
 * Returns whether one arrived.
 */
export async function loadDeliveredIdentity(sources: DeliveredIdentitySources): Promise<boolean> {
  const design = resolveInitialDesign();
  const signature = resolveInitialSignature();
  let designMissing = !DESIGNS[design] && !getRuntimeDesign(design);
  let signatureMissing = !getRuntimeSignature(signature);
  let delivered = false;

  for (const app of sources.apps) {
    if (!designMissing && !signatureMissing) break;
    const base = `/${app}`;
    const composition = await findComposition(base, sources);
    if (!composition) break;
    const inventory = await findPluginInventory(`${base}/plugins/index.json`);
    const plugins = joinCompositionWithInventory(composition.plugins, inventory, composition.entitlements ?? []).sources;

    const designSource = designMissing ? plugins.find((p) => p.type === "design" && p.id === design && p.url) : undefined;
    if (designSource?.url) {
      try {
        await loadDeliveredDesign(designFromSource(designSource, `${base}${designSource.url}`));
        designMissing = false;
        delivered = true;
      } catch (err) {
        console.error(`[identity] design "${design}" from ${base} failed to load`, err);
      }
    }
    const signatureSource = signatureMissing ? plugins.find((p) => p.type === "signature" && p.id === signature) : undefined;
    if (signatureSource) {
      registerDeliveredSignature(signatureSource);
      signatureMissing = false;
      delivered = true;
    }
  }

  if (delivered) {
    const page = readPageIdentity();
    bootIdentity({ signatures: page?.signatures, branding: page?.branding, followSystemMode: false });
  }
  return delivered;
}

/** The app's composition for this visitor, or null when they are not signed in. An expired
 *  access cookie is refreshed once, as the app's api client does. */
async function findComposition(base: string, sources: DeliveredIdentitySources): Promise<PluginManifest | null> {
  const request = () =>
    fetch(`${base}/api/v1/plugins`, { credentials: "include", headers: { Accept: "application/json" } });
  let response = await request();
  if (response.status === 401 && (await refreshSession(sources))) response = await request();
  if (!response.ok) return null;
  const body = (await response.json()) as ApiResponse<PluginManifest>;
  return body.success ? body.data : null;
}

/** Rotate the session through the IdP: the refresh cookie authenticates, the readable CSRF cookie
 *  goes back as the header. Without a CSRF cookie there is no session to refresh. */
async function refreshSession({ authUrl, authCookieSuffix }: DeliveredIdentitySources): Promise<boolean> {
  const csrf = findCookie(document.cookie, sessionCookieNames(authCookieSuffix ?? undefined).CSRF);
  if (!authUrl || !csrf) return false;
  const response = await fetch(`${authUrl}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", [CSRF_HEADER]: csrf },
    // The IdP's JSON parser rejects an empty body before it reads the refresh cookie.
    body: "{}",
  });
  return response.ok;
}
