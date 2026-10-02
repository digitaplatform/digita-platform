// The debug request line carries the request headers. A credential header must
// never reach a log line, whatever LOG_LEVEL and LOG_REDACT_FIELDS a deployment sets.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { lines } = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock("../src/core/config/env.js", () => ({
  env: {
    LOG_LEVEL: "debug", LOG_PRETTY: false, LOG_TO_FILE: false, LOG_FILE_PATH: "./logs",
    // Empty: the credential headers must be redacted without the deployment's list.
    LOG_REDACT_FIELDS: [],
    SERVICE_NAME: "digita-test", NODE_ENV: "test",
  },
}));

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

import Fastify from "fastify";
import {
  requestLoggerOnRequest,
  requestLoggerOnResponse,
  requestLoggerOnSend,
} from "../src/core/api/middleware/request-logger.js";
import { createLogger } from "../src/core/logging/logger.js";

const credentials = {
  cookie: "digita_at=eyJhbGciOiJFUzI1NiJ9.cookie-jwt.sig",
  "x-engine-api-key": "engine-api-key-value",
  "x-delegation-token": "eyJhbGciOiJFUzI1NiJ9.delegation-jwt.sig",
  authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.bearer-jwt.sig",
};

async function logRequest(): Promise<string> {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requestLoggerOnRequest);
  app.addHook("onResponse", requestLoggerOnResponse);
  app.addHook("onSend", requestLoggerOnSend);
  app.get("/api/v1/boot", async () => ({ ok: true }));
  await app.inject({
    method: "GET",
    url: "/api/v1/boot",
    headers: { ...credentials, accept: "application/json", "x-trace-marker": "visible-marker" },
  });
  await app.close();
  return lines.join("");
}

beforeEach(() => { lines.length = 0; });

describe("the request log line", () => {
  it("logs the request headers at debug, so the check below reads a real line", async () => {
    const log = await logRequest();
    expect(log).toContain('"direction":"REQUEST"');
    expect(log).toContain("visible-marker");
  });

  for (const [header, value] of Object.entries(credentials)) {
    it(`never carries the ${header} header's value`, async () => {
      const log = await logRequest();
      expect(log).not.toContain(value);
    });
  }
});

// logger.ts serializes `req` with pino.stdSerializers.req, whose output nests
// the header set one level deeper than the request line does.
describe("a log line that passes the request as req", () => {
  it("never carries a credential header's value", async () => {
    const app = Fastify({ logger: false });
    app.get("/api/v1/boot", async (request) => {
      createLogger("redaction-test").info({ req: request }, "handled");
      return { ok: true };
    });
    await app.inject({
      method: "GET",
      url: "/api/v1/boot",
      headers: { ...credentials, "x-trace-marker": "visible-marker" },
    });
    await app.close();
    const log = lines.join("");
    expect(log).toContain("visible-marker");
    for (const value of Object.values(credentials)) expect(log).not.toContain(value);
  });
});
