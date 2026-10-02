import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/logging/logger.js", () => {
  const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  return { createLogger: () => log, getRootLogger: () => log };
});
vi.mock("../src/core/config/env.js", () => ({ env: { TRANSLATION_SOURCE: "mongodb" } }));

import type { FastifyInstance } from "fastify";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { DocumentService } from "../src/core/document/document-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { registerTranslationRoutes } from "../src/core/api/translation-router.js";

type Handler = (request: unknown, reply: unknown) => Promise<unknown>;

/** The stored translation rows by id, as the seeder files them. */
function setup(rows: Record<string, Record<string, unknown>>) {
  const db = {
    findOne: vi.fn(async (_coll: string, id: string) => rows[id] ?? null),
    updateOne: vi.fn(async (_coll: string, id: string, data: Record<string, unknown>) => Object.assign(rows[id]!, data)),
  } as unknown as MongoDBService;
  const handlers = new Map<string, Handler>();
  const route = (method: string) => (path: string, handler: Handler) => handlers.set(`${method} ${path}`, handler);
  registerTranslationRoutes(
    { get: route("GET"), post: route("POST"), put: route("PUT"), delete: route("DELETE") } as unknown as FastifyInstance,
    "/api/v1",
    new TranslationService(db),
    {} as DocumentService,
  );
  const reset = async (locale: string, key: string) => {
    let status = 200;
    let body: unknown;
    const reply = { code: (c: number) => ((status = c), reply), send: (b: unknown) => ((body = b), reply) };
    await handlers.get("DELETE /api/v1/translations/:locale/:key/override")!(
      { user: { email: "admin@test", roles: ["Administrator"] }, params: { locale, key } },
      reply,
    );
    return { status, body };
  };
  return { reset, rows };
}

describe("DELETE /translations/:locale/:key/override", () => {
  it("resets an overridden option text, filed under the seeder's namespace", async () => {
    const id = "entity:de:option.Book.binding.Hardcover";
    const { reset, rows } = setup({
      [id]: { locale: "de", key: "option.Book.binding.Hardcover", value: "Fester Einband!", original_value: "Fester Einband", overridden: true },
    });
    const answer = await reset("de", "option.Book.binding.Hardcover");
    expect(answer).toMatchObject({ status: 200, body: { success: true, data: { reset: true } } });
    expect(rows[id]).toMatchObject({ value: "Fester Einband", overridden: false });
  });

  it("answers reset false for a text that was not overridden", async () => {
    const { reset } = setup({ "system:de:save": { locale: "de", key: "save", value: "Speichern", overridden: false } });
    expect(await reset("de", "save")).toMatchObject({ status: 200, body: { success: true, data: { reset: false } } });
  });

  it("answers 404 for a key that has no translation", async () => {
    const { reset } = setup({});
    expect(await reset("de", "nothing.here")).toMatchObject({
      status: 404,
      body: { success: false, error: { code: "NOT_FOUND" }, messages: [{ text: "not_found" }] },
    });
  });
});
