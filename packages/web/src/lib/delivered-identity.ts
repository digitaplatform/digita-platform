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
  IDENTITY_PREFERENCE_KEYS,
  loadDeliveredDesign,
  readPageIdentity,
  registerDeliveredSignature,
  resolveInitialDensity,
  resolveInitialDesign,
  resolveInitialMode,
  resolveInitialSignature,
  storeIdentityPreferences,
  type IdentityChoices,
} from "@digitaplatform/theme";

/** Where the page finds a signed-in visitor's identity: the tenant's apps and its IdP. */
export interface DeliveredIdentitySources {
  /** The tenant's apps, asked in this order; each serves its API under /<app>/. */
  apps: string[];
  /** The tenant IdP's public base URL, where an expired session is refreshed; null: none. */
  authUrl: string | null;
  /** The tenant's session cookie suffix (sessionCookieNames); null: the unsuffixed names. */
  authCookieSuffix: string | null;
}

/**
 * Put a signed-in visitor's page into the identity the app shows them, the way the app does it:
 * the choices the server keeps for them (mode, density, design, signature) become this browser's
 * own, and a design or signature the page does not bundle is loaded from the composition of the
 * tenant's app, whose entitlement check decides. Without a session cookie nothing is asked and
 * the default stays, as in the app before login. When anything changed, every identity layer is
 * applied again in its order. Returns whether anything changed.
 */
export async function loadDeliveredIdentity(sources: DeliveredIdentitySources): Promise<boolean> {
  const [firstApp] = sources.apps;
  if (!firstApp || !findCookie(document.cookie, csrfCookieName(sources))) return false;

  const before = currentChoices();
  const preferences = await findIdentityPreferences(`/${firstApp}`, sources);
  if (!preferences) return false;
  storeIdentityPreferences(preferences);
  let changed = currentChoices() !== before;

  const design = resolveInitialDesign();
  const signature = resolveInitialSignature();
  let designMissing = !DESIGNS[design] && !getRuntimeDesign(design);
  let signatureMissing = !getRuntimeSignature(signature);

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
        changed = true;
      } catch (err) {
        console.error(`[identity] design "${design}" from ${base} failed to load`, err);
      }
    }
    const signatureSource = signatureMissing ? plugins.find((p) => p.type === "signature" && p.id === signature) : undefined;
    if (signatureSource) {
      registerDeliveredSignature(signatureSource);
      signatureMissing = false;
      changed = true;
    }
  }

  if (changed) {
    const page = readPageIdentity();
    bootIdentity({ signatures: page?.signatures, branding: page?.branding, followSystemMode: false });
  }
  return changed;
}

const currentChoices = () =>
  [resolveInitialMode(), resolveInitialDensity(), resolveInitialDesign(), resolveInitialSignature()].join("|");

const csrfCookieName = ({ authCookieSuffix }: DeliveredIdentitySources) =>
  sessionCookieNames(authCookieSuffix ?? undefined).CSRF;

const PREFERENCE_FILTER = encodeURIComponent(
  JSON.stringify([["pref_key", "in", Object.values(IDENTITY_PREFERENCE_KEYS)]]),
);

/** The choices the server keeps for the signed-in visitor, or null when they are not signed in. */
async function findIdentityPreferences(
  base: string,
  sources: DeliveredIdentitySources,
): Promise<Record<keyof IdentityChoices, unknown> | null> {
  const response = await fetchSignedIn(`${base}/api/v1/resource/UserPreference?page_size=10&filters=${PREFERENCE_FILTER}`, sources);
  if (!response) return null;
  const body = (await response.json()) as ApiResponse<{ pref_key: string; value: unknown }[]>;
  if (!body.success || !body.data) return null;
  const rows = body.data;
  const value = (key: string) => rows.find((row) => row.pref_key === key)?.value;
  return {
    mode: value(IDENTITY_PREFERENCE_KEYS.mode),
    density: value(IDENTITY_PREFERENCE_KEYS.density),
    design: value(IDENTITY_PREFERENCE_KEYS.design),
    signature: value(IDENTITY_PREFERENCE_KEYS.signature),
  };
}

/** The app's plugin composition for the signed-in visitor, or null when they are not signed in. */
async function findComposition(base: string, sources: DeliveredIdentitySources): Promise<PluginManifest | null> {
  const response = await fetchSignedIn(`${base}/api/v1/plugins`, sources);
  if (!response) return null;
  const body = (await response.json()) as ApiResponse<PluginManifest>;
  return body.success ? body.data : null;
}

/** GET with the visitor's session; an expired access cookie is refreshed once, as the app's api
 *  client does. Null when the answer is not a success. */
async function fetchSignedIn(url: string, sources: DeliveredIdentitySources): Promise<Response | null> {
  const request = () => fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  let response = await request();
  if (response.status === 401 && (await refreshSession(sources))) response = await request();
  return response.ok ? response : null;
}

/** Rotate the session through the IdP: the refresh cookie authenticates, the readable CSRF cookie
 *  goes back as the header. */
async function refreshSession(sources: DeliveredIdentitySources): Promise<boolean> {
  const csrf = findCookie(document.cookie, csrfCookieName(sources));
  if (!sources.authUrl || !csrf) return false;
  const response = await fetch(`${sources.authUrl}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", [CSRF_HEADER]: csrf },
    // The IdP's JSON parser rejects an empty body before it reads the refresh cookie.
    body: "{}",
  });
  return response.ok;
}
