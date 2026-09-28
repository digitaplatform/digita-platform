import type { FastifyServerOptions } from "fastify";
import type { RateLimitPluginOptions } from "@fastify/rate-limit";

/**
 * The server options that decide who a request comes from. `trustProxy` is the number of proxies
 * in front of the engine (API_TRUSTED_PROXY_HOPS): Fastify then takes the client's address from
 * the X-Forwarded-For entry that the last trusted proxy wrote, which the client cannot choose. A
 * request without X-Forwarded-For, such as a call inside the cluster, keeps its socket peer. The
 * hop count trusts a peer by position, not by address, so a pod that reaches the engine directly
 * names its own key; and `request.host`, `hostname` and `protocol` now follow X-Forwarded-Host and
 * X-Forwarded-Proto, which nothing in the engine reads today.
 */
export function engineServerOptions(settings: { bodyLimit: number; trustedProxyHops: number }): FastifyServerOptions {
  return {
    logger: false,
    bodyLimit: settings.bodyLimit,
    trustProxy: settings.trustedProxyHops,
  };
}

/**
 * The limiter's options: a signed-in user has a budget of their own, and every other request
 * one per client address, which engineServerOptions makes the visitor's own.
 */
export function engineRateLimitOptions(settings: { max: number; timeWindow: string }): RateLimitPluginOptions {
  return {
    max: settings.max,
    timeWindow: settings.timeWindow,
    // Run in preParsing to make identity keying a phase GUARANTEE instead of an
    // ordering accident: @fastify/rate-limit injects its check per-route via an
    // onRoute listener that APPENDS to the route's own hook array, so at the
    // default onRequest phase it happened to run after the scope-level auth
    // hooks (each scope adds them before registering its routes) — request.user
    // was populated by declaration-order luck, with nothing enforcing it.
    // preParsing always runs after the entire onRequest phase (auth included),
    // regardless of registration order or future global hooks, so each identity
    // reliably gets its own budget; anonymous requests still key by IP.
    // preParsing (not preHandler) also rejects an over-limit request BEFORE
    // body parsing, instead of paying up to API_MAX_BODY_SIZE of parse cost
    // for a request that just gets a 429 anyway.
    // Trade-off: requests that auth or CSRF reject (401/403 in onRequest)
    // never reach the limiter — acceptable, both are cheap local checks.
    hook: "preParsing",
    keyGenerator: (request) => {
      return request.user?.email ?? request.ip;
    },
  };
}

/**
 * A byte size written `<n>`, `<n>kb`, `<n>mb` or `<n>gb`. A value in any other form stops the boot
 * and names its setting: a limit that silently became something else would guard nothing.
 */
export function parseBodyLimit(value: string, setting: string): number {
  const match = value.match(/^(\d+)\s*(kb|mb|gb)?$/i);
  if (!match) {
    throw new Error(`Environment variable ${setting} must be a size like 16kb or 10mb, got: ${value}`);
  }
  const num = parseInt(match[1]!, 10);
  switch (match[2]?.toLowerCase()) {
    case "kb":
      return num * 1024;
    case "mb":
      return num * 1024 * 1024;
    case "gb":
      return num * 1024 * 1024 * 1024;
    default:
      return num;
  }
}
