// A non-browser client opens the realtime socket with ?token=<access token>. No log
// line may carry that token, at the level a deployment runs (info) or at debug,
// whatever LOG_REDACT_FIELDS a deployment sets.
import { describe, it, expect, vi } from "vitest";

const { lines, settings } = vi.hoisted(() => ({
  lines: [] as string[],
  settings: {
    LOG_LEVEL: "debug", LOG_PRETTY: false, LOG_TO_FILE: false, LOG_FILE_PATH: "./logs",
    // Empty: the token must stay out of the log without the deployment's list.
    LOG_REDACT_FIELDS: [] as string[],
    SERVICE_NAME: "digita-test", APP_VERSION: "0.0.0", NODE_ENV: "test",
  },
}));

vi.mock("../src/core/config/env.js", () => ({ env: settings }));

// The real logger module with its real redaction; only the transport is swapped
// for a stream this test reads.
vi.mock("pino", async (importOriginal) => {
  const real = (await importOriginal()) as { default: (...args: unknown[]) => unknown };
  const capture = { write: (line: string) => { lines.push(line); } };
  const pino = Object.assign(
    (opts: Record<string, unknown>) => real.default({ ...opts, transport: undefined }, capture),
    real.default,
  );
  return { ...real, default: pino };
});

const token = "eyJhbGciOiJFUzI1NiJ9.query-jwt.sig";

/** Sends a plain GET and a websocket handshake, both with ?token=, through the
 *  request logger of a logger built at `level`, and returns the lines written. */
async function logRequests(level: "debug" | "info"): Promise<string[]> {
  settings.LOG_LEVEL = level;
  lines.length = 0;
  vi.resetModules();
  const { default: Fastify } = await import("fastify");
  const { default: fastifyWebsocket } = await import("@fastify/websocket");
  const { requestLoggerOnRequest, requestLoggerOnResponse, requestLoggerOnSend } = await import(
    "../src/core/api/middleware/request-logger.js"
  );
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requestLoggerOnRequest);
  app.addHook("onResponse", requestLoggerOnResponse);
  app.addHook("onSend", requestLoggerOnSend);
  await app.register(fastifyWebsocket);
  app.get("/ws", { websocket: true }, (socket) => { socket.close(); });
  app.get("/api/v1/boot", async () => ({ ok: true }));
  await app.ready();
  await app.inject({ method: "GET", url: `/api/v1/boot?token=${token}` });
  const socket = await app.injectWS(`/ws?token=${token}`);
  await new Promise((resolve) => socket.once("close", resolve));
  await app.close();
  return [...lines];
}

describe.each(["debug", "info"] as const)("the request log at %s", (level) => {
  it("logs the requests, so the check below reads real lines", async () => {
    const log = await logRequests(level);
    expect(log.some((line) => line.includes('"level":30') && line.includes('"msg":"GET /api/v1/boot'))).toBe(true);
    // The upgrade writes only the debug request line: onResponse does not fire for it.
    if (level === "debug") expect(log.some((line) => line.includes('"msg":"GET /ws'))).toBe(true);
  });

  it("never carries the ?token= value", async () => {
    const log = await logRequests(level);
    for (const line of log) expect(line).not.toContain(token);
  });
});
