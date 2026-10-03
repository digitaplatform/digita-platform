import type {
  ViewDefinition,
  ViewSection,
  ViewParamDefinition,
  ViewPermissionFallback,
} from "@digitaplatform/shared";
import type { DocumentService } from "../document/document-service.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import { PermissionDeniedError } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import type { ResponseContext } from "../api/response-context.js";
import { NotFoundError } from "../document/document-service.js";
import type { ResolverContext } from "./param-resolver.js";
import { runLinkSection } from "./section-runners/link-section.js";
import { runListSection } from "./section-runners/list-section.js";
import { runAggregateSection } from "./section-runners/aggregate-section.js";
import { createLogger } from "../logging/logger.js";
import { EngineError } from "../errors/engine-error.js";

const log = createLogger("view-engine");

/** A request the engine refuses for its shape: a parameter, a body or a file it cannot use. */
export class BadRequestError extends EngineError {
  constructor(code: string, params: Record<string, string> = {}) {
    super(code, params, 400, "BAD_REQUEST");
  }
}

export class ViewNotFoundError extends EngineError {
  constructor(public viewName: string) {
    super("view_not_found", { view: viewName }, 404, "VIEW_NOT_FOUND");
  }
}

export interface ViewEngineDeps {
  documentService: DocumentService;
  db: MongoDBService;
  registry: EntityRegistry;
  permissionChecker: PermissionChecker;
  /** The tenant's time zone (IANA), whose day a `$now` operand on a Date field names. */
  tenantTimeZone: () => string;
}

export interface ViewExecutionInput {
  rootName?: string;
  query: Record<string, string>;
}

export interface ViewExecutionResult {
  source: Record<string, unknown> | null;
  sections: Record<string, unknown>;
  entities: Record<string, string>;
}

export class ViewEngine {
  constructor(private deps: ViewEngineDeps) {}

  async execute(
    view: ViewDefinition,
    input: ViewExecutionInput,
    user: UserContext,
    ctx: ResponseContext,
  ): Promise<ViewExecutionResult> {
    // A disabled view must not execute — otherwise the admin "disable" action is a
    // no-op and the view keeps serving data. The registry still holds it (so it can
    // be re-enabled); only execution is refused, surfaced as not-found.
    if (view.enabled === false) {
      throw new ViewNotFoundError(view._id);
    }

    const anchored = view.anchored !== false;

    // For anchored views the URL :rootName takes precedence over the query
    // for the source-bound param. We inject it into the query map BEFORE
    // coercing so `required: true` on that param is satisfied by the URL.
    const queryWithRoot: Record<string, string> = { ...input.query };
    if (anchored) {
      if (!view.source) throw new EngineError("view_source_missing", { view: view._id }, 500, "VIEW_SOURCE_MISSING");
      if (!input.rootName) throw new BadRequestError("param_required", { param: "rootName" });
      queryWithRoot[view.source.param] = input.rootName;
    }

    // ─── Coerce + validate params ────────────────────────────
    const params = coerceParams(view.params ?? [], queryWithRoot);

    let rootDoc: Record<string, unknown> | null = null;
    if (anchored) {
      const doc = await this.deps.documentService.getDoc(
        view.source!.entity,
        input.rootName!,
        user,
        ctx,
      );
      rootDoc = doc.toJSON() as Record<string, unknown>;
    }

    const rctx: ResolverContext = {
      root: rootDoc,
      user,
      params,
      now: new Date(),
      warnings: [],
    };

    // ─── Fan sections out ─────────────────────────────────────
    const settled = await Promise.allSettled(
      view.sections.map((s) => this.runSection(view, s, rctx, user, ctx)),
    );

    const sections: Record<string, unknown> = {};
    // The entity each section that ran read, so a reader labels its rows without the view's
    // definition, which only a reader of View may open. A section that failed names none.
    const entities: Record<string, string> = {};
    for (let i = 0; i < view.sections.length; i++) {
      const sec = view.sections[i]!;
      const result = settled[i]!;
      const fallback: ViewPermissionFallback = sec.permission_fallback ?? "warn";

      if (result.status === "fulfilled") {
        sections[sec.key] = result.value;
        entities[sec.key] = sec.entity;
        continue;
      }

      const err = result.reason as Error;
      log.warn({ view: view._id, section: sec.key, err: err.message }, "section failed");

      if (fallback === "error") {
        // Re-throw — whole response fails. Attach context for the global error handler.
        throw err;
      }

      sections[sec.key] = sec.kind === "link" ? null : [];

      if (fallback === "silent") continue;

      const code =
        err instanceof PermissionDeniedError
          ? "omitted_no_permission"
          : err instanceof NotFoundError
            ? "omitted_not_found"
            : "section_failed";
      ctx.addRaw(sectionWarningText(sec, err), "warning", true, {
        path: `/sections/${sec.key}`,
        code,
      });
    }

    // Surface any token-resolution warnings collected during the run.
    for (const w of rctx.warnings) {
      ctx.addRaw(w, "info", false, { code: "token_unresolved" });
    }

    return { source: rootDoc, sections, entities };
  }

  private async runSection(
    view: ViewDefinition,
    section: ViewSection,
    rctx: ResolverContext,
    user: UserContext,
    ctx: ResponseContext,
  ): Promise<unknown> {
    switch (section.kind) {
      case "link":
        return runLinkSection(section, rctx, user, ctx, this.deps);
      case "list":
        return runListSection(
          section,
          rctx,
          user,
          ctx,
          this.deps,
          view.default_limit,
          view.max_limit,
        );
      case "aggregate":
        return runAggregateSection(section, rctx, user, this.deps);
    }
  }
}

function sectionWarningText(section: ViewSection, err: Error): string {
  const what =
    err instanceof PermissionDeniedError
      ? "permission denied"
      : err instanceof NotFoundError
        ? "not found"
        : err.message;
  return `Section "${section.key}" omitted: ${what}`;
}

/**
 * Apply param defaults and coerce string query values into typed params.
 * Throws BadRequestError on missing required params or invalid coercion.
 */
function coerceParams(
  defs: ViewParamDefinition[],
  query: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = query[def.name];
    if (raw === undefined || raw === "") {
      if (def.required) throw new BadRequestError("param_required", { param: def.name });
      if (def.default !== undefined) out[def.name] = def.default;
      continue;
    }
    out[def.name] = coerce(def, raw);
  }
  return out;
}

function coerce(def: ViewParamDefinition, raw: string): unknown {
  switch (def.type) {
    case "string":
    case "duration":
      return raw;
    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new BadRequestError("param_not_number", { param: def.name });
      return n;
    }
    case "boolean":
      return raw === "true" || raw === "1";
    case "date": {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new BadRequestError("param_not_date", { param: def.name });
      return d;
    }
    case "enum":
      if (def.enum_values && !def.enum_values.includes(raw)) {
        throw new BadRequestError("param_not_one_of", { param: def.name, values: def.enum_values.join(", ") });
      }
      return raw;
  }
}
