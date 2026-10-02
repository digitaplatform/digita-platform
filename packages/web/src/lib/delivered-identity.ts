import {
  designFromSource,
  findPluginInventory,
  joinCompositionWithInventory,
  type PluginManifest,
  type PluginSource,
} from "@digitaplatform/plugins";
import { CSRF_HEADER, findCookie, sessionCookieNames, type ApiResponse } from "@digitaplatform/shared";
import {
  bootIdentity,
  DESIGNS,
  lookCookieDomain,
  getRuntimeDesign,
  IDENTITY_PREFERENCE_KEYS,
  loadDeliveredDesign,
  readPageIdentity,
  resolveInitialDensity,
  resolveInitialDesign,
  resolveInitialMode,
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
 * the choices the server keeps for them (mode, density, design) become this browser's own, and a
 * design the page does not bundle is loaded from the composition of the tenant's app, whose
 * entitlement check decides. A page keeps its site's signature. Without a session cookie
 * nothing is asked and the default stays, as in the app before login. When anything changed, every
 * identity layer is applied again in its order. Returns whether anything changed.
 */
export async function loadDeliveredIdentity(sources: DeliveredIdentitySources): Promise<boolean> {
  const [firstApp] = sources.apps;
  if (!firstApp || !findCookie(document.cookie, csrfCookieName(sources))) return false;

  const before = currentChoices();
  const preferences = await findIdentityPreferences(`/${firstApp}`, sources);
  if (!preferences) return false;
  storeIdentityPreferences(preferences, lookCookieDomain(sources.authUrl ?? ""));
  let changed = currentChoices() !== before;

  const design = resolveInitialDesign();
  if (!DESIGNS[design] && !getRuntimeDesign(design) && (await loadDesignFromApps(design, sources))) changed = true;

  if (changed) {
    const page = readPageIdentity();
    bootIdentity({ signature: page?.signature, signatures: page?.signatures, branding: page?.branding, mode: page?.mode, followSystemMode: false });
    window.dispatchEvent(new Event(IDENTITY_DELIVERED_EVENT));
  }
  return changed;
}

/** What the page hears when the account's choices painted it again, so a part that shows a choice,
 *  such as the light/dark button, reads it anew. */
export const IDENTITY_DELIVERED_EVENT = "digita:identity-delivered";

/**
 * Keep a choice the visitor made on the website on their account too, as the app's button does:
 * their own UserPreference row of the key is updated, or created. The website takes the account's
 * choices on every page load, so a choice kept only in this browser would be undone by the next.
 * Without a session, and for the demo user, whose read the engine refuses, the choice stays in
 * this browser and nothing is written. A write the account refuses throws, naming the key.
 * The page's writes run one after another, so a second click finds the row the first created.
 */
export function storeIdentityChoiceOnAccount(choices: Partial<IdentityChoices>, sources: DeliveredIdentitySources): Promise<void> {
  const write = accountWrites.then(() => writeIdentityChoices(choices, sources));
  accountWrites = write.catch(() => {});
  return write;
}

/** This page's account writes in order. Two overlapping lookups would both find no row, both
 *  create one, and the account refuses the second row of the key, keeping the first choice. */
let accountWrites: Promise<void> = Promise.resolve();

async function writeIdentityChoices(choices: Partial<IdentityChoices>, sources: DeliveredIdentitySources): Promise<void> {
  const [firstApp] = sources.apps;
  if (!firstApp || !findCookie(document.cookie, csrfCookieName(sources))) return;
  const resource = `/${firstApp}/api/v1/resource/UserPreference`;
  for (const [choice, value] of Object.entries(choices)) {
    if (value === undefined) continue;
    const key = IDENTITY_PREFERENCE_KEYS[choice as keyof IdentityChoices];
    const filter = encodeURIComponent(JSON.stringify([["pref_key", "=", key]]));
    const response = await fetchSignedIn(`${resource}?page_size=1&filters=${filter}`, sources);
    if (!response) return;
    const own = ((await response.json()) as ApiResponse<{ _id: string }[]>).data?.[0];
    const saved = own
      ? await sendSignedIn("PUT", `${resource}/${encodeURIComponent(own._id)}`, { value }, sources)
      : await sendSignedIn("POST", resource, { pref_key: key, value }, sources);
    if (!saved) throw new Error(`the account did not keep ${key}`);
  }
}

/**
 * Load a design the page does not bundle from the first of the tenant's apps that delivers it to
 * this visitor: the app's composition for the visitor decides, so a visitor who is not signed in,
 * or not entitled, gets nothing. Returns whether it loaded.
 */
export async function loadDesignFromApps(design: string, sources: DeliveredIdentitySources): Promise<boolean> {
  for (const app of sources.apps) {
    const base = `/${app}`;
    const plugins = await findDeliveredPlugins(base, sources);
    if (!plugins) return false;
    if (await loadDesignFrom(base, plugins, design)) return true;
  }
  return false;
}

/** The plugins an app delivers to the signed-in visitor, or null when they are not signed in. */
async function findDeliveredPlugins(base: string, sources: DeliveredIdentitySources): Promise<PluginSource[] | null> {
  const composition = await findComposition(base, sources);
  if (!composition) return null;
  const inventory = await findPluginInventory(`${base}/plugins/index.json`);
  return joinCompositionWithInventory(composition.plugins, inventory, composition.entitlements ?? []).sources;
}

/** Load `design` when the app's plugins carry it. A stylesheet that fails is logged and reported
 *  as not loaded. */
async function loadDesignFrom(base: string, plugins: PluginSource[], design: string): Promise<boolean> {
  const source = plugins.find((p) => p.type === "design" && p.id === design && p.url);
  if (!source?.url) return false;
  try {
    await loadDeliveredDesign(designFromSource(source, `${base}${source.url}`));
    return true;
  } catch (err) {
    console.error(`[identity] design "${design}" from ${base} failed to load`, err);
    return false;
  }
}

const currentChoices = () =>
  [resolveInitialMode(), resolveInitialDensity(), resolveInitialDesign()].join("|");

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

/** A write with the visitor's session and the CSRF header, refreshed once as fetchSignedIn does.
 *  Whether the server took it. */
async function sendSignedIn(method: "POST" | "PUT", url: string, body: unknown, sources: DeliveredIdentitySources): Promise<boolean> {
  const request = () =>
    fetch(url, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [CSRF_HEADER]: findCookie(document.cookie, csrfCookieName(sources)) ?? "",
      },
      body: JSON.stringify(body),
    });
  let response = await request();
  if (response.status === 401 && (await refreshSession(sources))) response = await request();
  return response.ok;
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
