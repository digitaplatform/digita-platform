import { describe, it, expect, vi, beforeEach } from "vitest";

// The reseed route's two guards, read off the demo tenant setting: Administrator only, and in
// production only on a demo tenant. A body without a mode is refused after both guards, so a
// 400 INVALID_MODE proves a request passed them without running a reseed.
vi.mock("../src/core/config/env.js", () => ({ env: { NODE_ENV: "production", DEMO_TENANT: false } }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));
const { reseedAppData } = vi.hoisted(() => ({ reseedAppData: vi.fn() }));
vi.mock("../src/core/setup/reseed-app-data.js", () => ({ reseedAppData }));

import type { FastifyInstance } from "fastify";
import { env } from "../src/core/config/env.js";
import { registerAdminReseedRoutes } from "../src/core/api/admin-reseed-router.js";
import type { ReseedDeps } from "../src/core/setup/reseed-app-data.js";

type Handler = (request: unknown, reply: unknown) => Promise<unknown>;

let reseed: Handler;
registerAdminReseedRoutes(
  { post: (_path: string, handler: Handler) => (reseed = handler) } as unknown as FastifyInstance,
  "/api/v1",
  {} as ReseedDeps,
);

async function call(nodeEnv: string, demoTenant: boolean, roles: string[], body: Record<string, unknown> = {}) {
  Object.assign(env, { NODE_ENV: nodeEnv, DEMO_TENANT: demoTenant });
  let status = 200;
  let sent: unknown;
  const reply = {
    code: (code: number) => ((status = code), reply),
    send: (payload: unknown) => ((sent = payload), reply),
  };
  await reseed({ user: { email: "a@test", roles }, body }, reply);
  return { status, body: sent };
}

beforeEach(() => reseedAppData.mockReset());

describe("POST /admin/reseed", () => {
  it("refuses a caller who is no Administrator, on a demo tenant too", async () => {
    expect(await call("production", true, ["System User"], { mode: "demo" })).toMatchObject({
      status: 403,
      body: { error: { code: "FORBIDDEN" } },
    });
    expect(reseedAppData).not.toHaveBeenCalled();
  });

  it("refuses in production on a tenant that is no demo, naming the setting", async () => {
    expect(await call("production", false, ["Administrator"], { mode: "demo" })).toMatchObject({
      status: 403,
      body: { error: { code: "RESEED_DISABLED", detail: "set DEMO_TENANT to enable in production" } },
    });
    expect(reseedAppData).not.toHaveBeenCalled();
  });

  it("passes in production on a demo tenant", async () => {
    expect(await call("production", true, ["Administrator"])).toMatchObject({
      status: 400,
      body: { error: { code: "INVALID_MODE" } },
    });
  });

  it("passes outside production on a tenant that is no demo", async () => {
    expect(await call("development", false, ["Administrator"])).toMatchObject({
      status: 400,
      body: { error: { code: "INVALID_MODE" } },
    });
  });

  it("runs the reseed in the mode asked for once both guards pass", async () => {
    reseedAppData.mockResolvedValue({ mode: "template" });
    expect(await call("production", true, ["Administrator"], { mode: "template" })).toMatchObject({
      status: 200,
      body: { success: true, data: { mode: "template" } },
    });
    expect(reseedAppData).toHaveBeenCalledWith("template", {});
  });
});
