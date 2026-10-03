import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineRateLimitOptions, engineServerOptions } from "../src/core/api/http-options.js";

// Who a request comes from, as the engine decides it (digitaplatform/digita-platform#35): an
// engine-like server built from the engine's own server and limiter options, reached through one
// proxy, the ingress controller at INGRESS.

const INGRESS = "10.1.0.5";

async function engineLike(trustedProxyHops: number, max: number): Promise<FastifyInstance> {
  const app = Fastify(engineServerOptions({ bodyLimit: 1024, trustedProxyHops }));
  await app.register(rateLimit, engineRateLimitOptions({ max, timeWindow: "1m" }));
  app.get("/ip", async (request) => ({ ip: request.ip }));
  await app.ready();
  return app;
}

function get(app: FastifyInstance, forwardedFor?: string) {
  return app.inject({
    method: "GET",
    url: "/ip",
    remoteAddress: INGRESS,
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  });
}

describe("who a request comes from", () => {
  it("takes the visitor's address from the entry the one trusted proxy wrote", async () => {
    const app = await engineLike(1, 100);
    expect((await get(app, "203.0.113.7")).json().ip).toBe("203.0.113.7");
    // A client's own X-Forwarded-For comes first; the proxy appends the address it saw.
    expect((await get(app, "198.51.100.9, 203.0.113.7")).json().ip).toBe("203.0.113.7");
    // A call inside the cluster carries no X-Forwarded-For and keeps its peer.
    expect((await get(app)).json().ip).toBe(INGRESS);
  });

  it("gives each visitor behind the ingress a budget of their own", async () => {
    const app = await engineLike(1, 1);
    expect((await get(app, "203.0.113.7")).statusCode).toBe(200);
    expect((await get(app, "203.0.113.8")).statusCode).toBe(200);
    expect((await get(app, "203.0.113.7")).statusCode).toBe(429);
  });

  it("does not let a client choose its budget by writing its own X-Forwarded-For", async () => {
    const app = await engineLike(1, 1);
    expect((await get(app, "192.0.2.1, 203.0.113.7")).statusCode).toBe(200);
    expect((await get(app, "192.0.2.2, 203.0.113.7")).statusCode).toBe(429);
  });

  it("keys a request by its peer when no proxy is trusted", async () => {
    const app = await engineLike(0, 100);
    expect((await get(app, "203.0.113.7")).json().ip).toBe(INGRESS);
  });
});

describe("the engine's proxy setting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses to load without API_TRUSTED_PROXY_HOPS or with anything but a count, naming it", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");
    for (const bad of ["", "-1", "1.5", "x", " 1"]) {
      vi.resetModules();
      vi.stubEnv("API_TRUSTED_PROXY_HOPS", bad);
      await expect(import("../src/core/config/env.js")).rejects.toMatchObject({ params: { setting: "API_TRUSTED_PROXY_HOPS" } });
    }
  });

  it("reads a count", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");
    vi.stubEnv("API_TRUSTED_PROXY_HOPS", "2");
    expect((await import("../src/core/config/env.js")).env.API_TRUSTED_PROXY_HOPS).toBe(2);
  });
});
