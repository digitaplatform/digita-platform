import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { isReseedAllowed, reseedAppData, type ReseedDeps } from "../setup/reseed-app-data.js";
import { successResponse } from "./response-model.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("admin-reseed-router");

interface ReseedBody {
  mode?: string;
}

/**
 * Admin reseed endpoint — destructive bootstrap of app data via the setup
 * wizard (`reseedAppData` says what each mode loads).
 */
export function registerAdminReseedRoutes(
  app: FastifyInstance,
  prefix: string,
  deps: ReseedDeps,
): void {
  app.post(
    `${prefix}/admin/reseed`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!user || !user.roles?.includes("Administrator")) {
        return reply.code(403).send({ success: false, error: { code: "FORBIDDEN" } });
      }

      if (!isReseedAllowed()) {
        return reply.code(403).send({
          success: false,
          error: {
            code: "RESEED_DISABLED",
            detail: "the reseed runs only on an app engine of a demo tenant: DEMO_TENANT on and SITE_ID empty",
          },
        });
      }

      const body = (request.body ?? {}) as ReseedBody;
      const mode = body.mode === "demo" ? "demo" : body.mode === "template" ? "template" : null;
      if (!mode) {
        return reply.code(400).send({
          success: false,
          error: { code: "INVALID_MODE", detail: "mode must be 'template' or 'demo'" },
        });
      }

      log.warn({ mode, by: user.email }, "admin reseed starting — destructive operation");

      const summary = await reseedAppData(mode, deps);

      log.info({ summary }, "admin reseed finished");
      return reply.send(successResponse(summary));
    },
  );
}

