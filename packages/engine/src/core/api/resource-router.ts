import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { DocumentService } from "../document/document-service.js";
import type { LocaleResolver } from "../i18n/locale-resolver.js";
import type { RealtimeService } from "../realtime/realtime-service.js";
import type { UserContext } from "../permissions/types.js";
import { callerIsInternal, stripInternalFields } from "../auth/audience.js";
import { createDelegationClient } from "../auth/delegation-client.js";
import { ResponseContext } from "./response-context.js";
import { successResponse, errorResponse } from "./response-model.js";
import type { ListQuery } from "../database/filter-builder.js";
import type { HookServices } from "../hooks/hook-runner.js";
import type { DelegationScope } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("resource-router");

// One mint client for the process — the engine mints on-behalf tokens for hooks
// that drive a satellite (e.g. the ERP ZUGFeRD hook → digita-report).
const delegationClient = createDelegationClient();

const GUEST_USER: UserContext = { _id: "Guest", email: "Guest", roles: ["Guest"] };

function getUser(request: FastifyRequest): UserContext {
  return request.user ?? GUEST_USER;
}

/** P-SEC/R5: strip operator-identity fields (owner/modified_by) from a response
 *  row — reads AND write echoes (update/submit/cancel/transition preserve the
 *  ORIGINAL creator's owner) — for non-internal (external) audiences. The operator
 *  resource path was only hardened for anonymous callers (public-router).
 *  Internal/service callers keep them. Mutates in place; null/non-object rows
 *  pass through untouched. */
function projectRead<T>(request: FastifyRequest, row: T): T {
  if (callerIsInternal(request.user) || !row || typeof row !== "object") return row;
  return stripInternalFields(row as Record<string, unknown>) as T;
}

/**
 * Auto-register CRUD routes for all entities.
 */
export function registerResourceRoutes(
  app: FastifyInstance,
  prefix: string,
  registry: EntityRegistry,
  documentService: DocumentService,
  localeResolver: LocaleResolver,
  realtimeService: RealtimeService,
): void {
  const basePath = `${prefix}/resource`;

  // Resolve the request's UI language (token → Accept-Language → default) so reads
  // return data values translated to the viewer's language (translatable fields).
  const localeOf = (request: FastifyRequest): Promise<string> =>
    localeResolver.resolveLanguage(
      getUser(request).language,
      request.headers["accept-language"] as string | undefined,
    );

  // Broadcast a committed write so connected clients invalidate their caches.
  const emitChange = (op: "insert" | "update" | "delete", doctype: string, name: unknown): void => {
    if (typeof name === "string" && name) realtimeService.broadcast({ entity: doctype, name, op });
  };

  // ─── LIST ──────────────────────────────────────────────
  app.get(`${basePath}/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const query = request.query as Record<string, unknown>;

    const listQuery: ListQuery = {
      fields: query["fields"] ? JSON.parse(query["fields"] as string) : undefined,
      filters: query["filters"] ? JSON.parse(query["filters"] as string) : undefined,
      or_filters: query["or_filters"] ? JSON.parse(query["or_filters"] as string) : undefined,
      order_by: query["order_by"] as string,
      limit: query["limit"] ? Number(query["limit"]) : undefined,
      offset: query["offset"] ? Number(query["offset"]) : undefined,
      page: query["page"] ? Number(query["page"]) : undefined,
      page_size: query["page_size"] ? Number(query["page_size"]) : undefined,
      search: query["search"] as string,
    };

    const ctx = new ResponseContext();
    const result = await documentService.getList(doctype, listQuery, getUser(request), ctx, await localeOf(request));

    const rows = callerIsInternal(request.user)
      ? result.data
      : result.data.map((r) => stripInternalFields(r as Record<string, unknown>));
    return reply.send(
      successResponse(rows, ctx.getMessages(), {
        total: result.total,
        page: result.page,
        page_size: result.page_size,
        total_pages: result.total_pages,
      }),
    );
  });

  // ─── READ SINGLE ───────────────────────────────────────
  // The one row of an is_single entity, without the caller knowing its _id
  // (singles have no naming convention). `single` is a reserved sub-path, same
  // as count/print/submit/… — a non-single entity returns 400. 404 when the
  // single has not been seeded yet. Registered before /:doctype/:name; Fastify
  // matches the static `single` segment ahead of the parametric :name.
  app.get(`${basePath}/:doctype/single`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const entity = registry.get(doctype);
    if (!entity.is_single) {
      return reply
        .code(400)
        .send(
          errorResponse(
            400,
            "NOT_A_SINGLE",
            `Entity "${doctype}" is not a single-type entity`,
            [{ text: "not_a_single", type: "error", show: true, params: { doctype } }],
            request.traceId ?? "",
          ),
        );
    }
    const ctx = new ResponseContext();
    const row = await documentService.getSingle(doctype, getUser(request), ctx, await localeOf(request));
    return reply.send(successResponse(projectRead(request, row), ctx.getMessages()));
  });

  // ─── READ ──────────────────────────────────────────────
  app.get(`${basePath}/:doctype/:name`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype, name } = request.params as { doctype: string; name: string };
    const ctx = new ResponseContext();
    const doc = await documentService.getDoc(doctype, name, getUser(request), ctx, await localeOf(request));
    return reply.send(successResponse(projectRead(request, doc.toJSON()), ctx.getMessages()));
  });

  // Available actions for a document (entity.actions filtered by show_if +
  // requires_permission against this doc + user).
  app.get(
    `${basePath}/:doctype/:name/actions`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const ctx = new ResponseContext();
      const actions = await documentService.getAvailableActions(doctype, name, getUser(request));
      return reply.send(successResponse(actions, ctx.getMessages()));
    },
  );

  // ─── PREVIEW (compute, no persist) ─────────────────────
  // Distinct path from CREATE (extra `preview` segment), so no route collision.
  app.post(`${basePath}/:doctype/preview`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const data = request.body as Record<string, unknown>;
    const ctx = new ResponseContext();

    const doc = await documentService.preview(doctype, data, getUser(request), ctx);
    return reply.send(successResponse(projectRead(request, doc.toJSON()), ctx.getMessages()));
  });

  // ─── CREATE ────────────────────────────────────────────
  app.post(`${basePath}/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const data = request.body as Record<string, unknown>;
    const ctx = new ResponseContext();

    const doc = await documentService.insert(doctype, data, getUser(request), ctx);
    const json = doc.toJSON();
    emitChange("insert", doctype, (json as Record<string, unknown>)["_id"]);
    if (localeResolver.affects(doctype)) await localeResolver.refresh();
    return reply.code(201).send(successResponse(json, ctx.getMessages()));
  });

  // ─── UPDATE ────────────────────────────────────────────
  app.put(`${basePath}/:doctype/:name`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype, name } = request.params as { doctype: string; name: string };
    const data = request.body as Record<string, unknown>;
    const ctx = new ResponseContext();

    // Optimistic concurrency: honor If-Match (the `modified` ISO the client last
    // saw). ETag-style quotes are tolerated. Absent → last-write-wins (back-compat).
    const ifMatch = request.headers["if-match"];
    const expectedModified =
      typeof ifMatch === "string" && ifMatch.length > 0 ? ifMatch.replace(/^"|"$/g, "") : undefined;

    const doc = await documentService.update(doctype, name, data, getUser(request), ctx, {
      expectedModified,
    });
    emitChange("update", doctype, name);
    if (localeResolver.affects(doctype)) await localeResolver.refresh();
    return reply.send(successResponse(projectRead(request, doc.toJSON()), ctx.getMessages()));
  });

  // ─── DELETE ────────────────────────────────────────────
  app.delete(`${basePath}/:doctype/:name`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype, name } = request.params as { doctype: string; name: string };
    const ctx = new ResponseContext();

    await documentService.deleteDoc(doctype, name, getUser(request), ctx);
    emitChange("delete", doctype, name);
    if (localeResolver.affects(doctype)) await localeResolver.refresh();
    return reply.send(successResponse(null, ctx.getMessages()));
  });

  // ─── SUBMIT ────────────────────────────────────────────
  app.post(
    `${basePath}/:doctype/:name/submit`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const ctx = new ResponseContext();

      const doc = await documentService.submit(doctype, name, getUser(request), ctx);
      emitChange("update", doctype, name);
      return reply.send(successResponse(projectRead(request, doc.toJSON()), ctx.getMessages()));
    },
  );

  // ─── CANCEL ────────────────────────────────────────────
  app.post(
    `${basePath}/:doctype/:name/cancel`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const ctx = new ResponseContext();

      const doc = await documentService.cancel(doctype, name, getUser(request), ctx);
      emitChange("update", doctype, name);
      return reply.send(successResponse(projectRead(request, doc.toJSON()), ctx.getMessages()));
    },
  );

  // ─── AMEND ─────────────────────────────────────────────
  app.post(
    `${basePath}/:doctype/:name/amend`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const ctx = new ResponseContext();

      const doc = await documentService.amend(doctype, name, getUser(request), ctx);
      const json = doc.toJSON();
      emitChange("insert", doctype, (json as Record<string, unknown>)["_id"]);
      return reply.code(201).send(successResponse(json, ctx.getMessages()));
    },
  );

  // ─── COPY ──────────────────────────────────────────────
  app.post(
    `${basePath}/:doctype/:name/copy`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const ctx = new ResponseContext();

      const doc = await documentService.copyDoc(doctype, name, getUser(request), ctx);
      return reply.code(201).send(successResponse(doc.toJSON(), ctx.getMessages()));
    },
  );

  // ─── COUNT ─────────────────────────────────────────────
  app.get(`${basePath}/:doctype/count`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const query = request.query as Record<string, unknown>;
    const filters = query["filters"] ? JSON.parse(query["filters"] as string) : undefined;

    // Pass the real caller so count enforces select + per-user scope (P-SEC) —
    // previously it defaulted to GUEST and counted unscoped over the whole collection.
    const count = await documentService.count(doctype, filters, getUser(request));
    return reply.send(successResponse({ count }));
  });

  // ─── PRINT ────────────────────────────────────────────
  app.get(
    `${basePath}/:doctype/:name/print`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const ctx = new ResponseContext();
      const doc = await documentService.getDoc(doctype, name, getUser(request), ctx, await localeOf(request));
      return reply.send(successResponse(projectRead(request, doc.toJSON()), ctx.getMessages()));
    },
  );

  // ─── PERIOD STATUS (pre-flight) ───────────────────────
  // FE banner uses this to warn the user BEFORE they hit submit when the
  // doc's effective date falls into a closed accounting/calendar period.
  // Submit still runs its own check; this is purely UX.
  app.get(
    `${basePath}/:doctype/:name/period-status`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const result = await documentService.getPeriodStatus(doctype, name, getUser(request));
      return reply.send(successResponse(result));
    },
  );

  // ─── WORKFLOW TRANSITION ─────────────────────────────
  // Dedicated endpoint for state transitions. Routes through
  // `DocumentService.transition` which bypasses the standard `write` perm
  // check — `WorkflowEngine.validateTransition` enforces
  // `transitions[].allowed_roles` and the declared condition instead.
  // This allows a role that is `write`-stripped in the current state to
  // still trigger transitions for which it's authorised.
  app.post(
    `${basePath}/:doctype/:name/transition`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const { to } = request.body as { to: string; comment?: string };
      const ctx = new ResponseContext();

      const doc = await documentService.transition(doctype, name, to, getUser(request), ctx);
      emitChange("update", doctype, name);
      return reply.send(successResponse(projectRead(request, doc.toJSON()), ctx.getMessages()));
    },
  );

  // Bounded-parallelism helper. Each per-name call still opens its own
  // transaction inside DocumentService; only the API-layer driver runs in
  // parallel. Concurrency=10 trades modest server load for ~10x latency
  // reduction on bulk lists.
  const BULK_CONCURRENCY = 10;
  async function runBulk(
    names: string[],
    perItem: (name: string) => Promise<void>,
  ): Promise<{ ok: string[]; failed: Array<{ name: string; error: string }> }> {
    const ok: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    for (let i = 0; i < names.length; i += BULK_CONCURRENCY) {
      const slice = names.slice(i, i + BULK_CONCURRENCY);
      const results = await Promise.allSettled(
        slice.map(async (name) => {
          await perItem(name);
          return name;
        }),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j]!;
        const name = slice[j]!;
        if (r.status === "fulfilled") {
          ok.push(name);
        } else {
          const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
          failed.push({ name, error: message });
        }
      }
    }
    return { ok, failed };
  }

  // ─── BULK DELETE ──────────────────────────────────────
  app.post(
    `${basePath}/:doctype/bulk-delete`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype } = request.params as { doctype: string };
      const { names } = request.body as { names: string[] };
      const user = getUser(request);

      const { ok: deleted, failed } = await runBulk(names, async (name) => {
        const itemCtx = new ResponseContext();
        await documentService.deleteDoc(doctype, name, user, itemCtx);
      });
      for (const n of deleted) emitChange("delete", doctype, n);

      const ctx = new ResponseContext();
      if (deleted.length > 0) {
        ctx.success("bulk_delete_completed", {
          deleted: String(deleted.length),
          total: String(names.length),
        });
      }
      if (failed.length > 0) {
        ctx.warning("bulk_delete_partial_failure", {
          failed: String(failed.length),
          total: String(names.length),
        });
      }

      return reply.send(successResponse({ deleted, failed }, ctx.getMessages()));
    },
  );

  // ─── BULK SUBMIT ──────────────────────────────────────
  app.post(
    `${basePath}/:doctype/bulk-submit`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype } = request.params as { doctype: string };
      const { names } = request.body as { names: string[] };
      const user = getUser(request);

      const { ok: submitted, failed } = await runBulk(names, async (name) => {
        const itemCtx = new ResponseContext();
        await documentService.submit(doctype, name, user, itemCtx);
      });
      for (const n of submitted) emitChange("update", doctype, n);

      const ctx = new ResponseContext();
      if (submitted.length > 0) {
        ctx.success("bulk_submit_completed", {
          submitted: String(submitted.length),
          total: String(names.length),
        });
      }
      if (failed.length > 0) {
        ctx.warning("bulk_submit_partial_failure", {
          failed: String(failed.length),
          total: String(names.length),
        });
      }
      return reply.send(successResponse({ submitted, failed }, ctx.getMessages()));
    },
  );

  // ─── BULK CANCEL ──────────────────────────────────────
  app.post(
    `${basePath}/:doctype/bulk-cancel`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype } = request.params as { doctype: string };
      const { names } = request.body as { names: string[] };
      const user = getUser(request);

      const { ok: cancelled, failed } = await runBulk(names, async (name) => {
        const itemCtx = new ResponseContext();
        await documentService.cancel(doctype, name, user, itemCtx);
      });
      for (const n of cancelled) emitChange("update", doctype, n);

      const ctx = new ResponseContext();
      if (cancelled.length > 0) {
        ctx.success("bulk_cancel_completed", {
          cancelled: String(cancelled.length),
          total: String(names.length),
        });
      }
      if (failed.length > 0) {
        ctx.warning("bulk_cancel_partial_failure", {
          failed: String(failed.length),
          total: String(names.length),
        });
      }
      return reply.send(successResponse({ cancelled, failed }, ctx.getMessages()));
    },
  );

  // ─── ACTION ───────────────────────────────────────────
  // Looks up the action in entity meta, then delegates to
  // `documentService.runAction` which:
  //   opens a transaction
  //   re-loads the doc inside the session
  //   runs the registered hook handler (`entity.hooks.actions[action_name]`)
  // The handler's return value (typically `{ created: { entity, name } }`)
  // is forwarded to the client so the FE can navigate to a spawned doc.
  app.post(
    `${basePath}/:doctype/:name/action/:action_name`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name, action_name } = request.params as {
        doctype: string;
        name: string;
        action_name: string;
      };
      const dialogData = (request.body as Record<string, unknown>) ?? {};
      const user = getUser(request);
      const ctx = new ResponseContext();

      const entity = registry.get(doctype);
      const action = entity.actions?.find((a) => a.action === action_name);
      if (!action) {
        return reply
          .code(404)
          .send(
            successResponse(null, [
              { text: "action_not_found", type: "error", show: true, params: { action: action_name } },
            ]),
          );
      }

      // Give the action hook a mint capability bound to THIS request's user JWT
      // (kept engine-side; the hook receives only the minted token). Absent when
      // the caller has no user JWT (service path) — post-cutover the ERP hook
      // then THROWS rather than falling back.
      const rawToken = request.rawAccessToken;
      const extraServices: Partial<HookServices> | undefined = rawToken
        ? { mintDelegation: (scope: DelegationScope) => delegationClient.mint(rawToken, scope) }
        : undefined;
      const result = await documentService.runAction(
        doctype,
        name,
        action_name,
        user,
        ctx,
        dialogData,
        extraServices,
      );
      ctx.success("action_executed", { action: action.label });
      return reply.send(
        successResponse({ result: result ?? null, dialog_data: dialogData }, ctx.getMessages()),
      );
    },
  );

  log.info({ entities: registry.getAllNames().length }, "Resource routes registered");
}
