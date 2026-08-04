import { resolve } from "path";
import { pathToFileURL } from "url";
import { existsSync } from "fs";
import type { EntityDefinition, DelegationScope } from "@digitaplatform/shared";
import type { BaseDocument } from "../document/base-document.js";
import type { ResponseContext } from "../api/response-context.js";
import type { ClientSession } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { UserContext } from "../permissions/types.js";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("hook-runner");

/**
 * True when a thrown value DECLARES an explicit integer 4xx `statusCode` (the
 * shared `DeclaredClientError` convention). Such a throw is an EXPECTED business-
 * rule / lifecycle rejection that the global error handler surfaces as a typed
 * 4xx — not a server fault — so it should log at `warn`, not raise the `error`-
 * level "Hook execution failed" server alarm. Mirrors the handler's own range
 * check (400–499); a bare 500 or a non-integer stays at `error`.
 */
function declaresClientError(err: unknown): boolean {
  const sc = (err as { statusCode?: unknown } | null | undefined)?.statusCode;
  return typeof sc === "number" && Number.isInteger(sc) && sc >= 400 && sc <= 499;
}

/**
 * Raised when a hook declaration resolves to no function: no module file exists
 * under any module directory, the module that does exist exports no such name,
 * or the reference carries no `.functionName` part at all.
 *
 * Thrown twice over one declaration, at two different moments. `loadHookFunction`
 * raises it while loading, knowing only the reference; `registerHook` catches
 * that, adds the entity and the slot it sits in, and keeps the qualified copy for
 * two uses — one line in the load report, and the body of the marker it registers
 * in the slot, so the same message reaches whoever triggers the operation.
 */
export class UnresolvedHookError extends Error {
  constructor(
    public hookPath: string,
    public detail: string,
    /** Where the declaration sits. Filled in by `registerHook`; `loadHookFunction`
     *  sees the reference alone and leaves both empty. */
    public entityName?: string,
    public slot?: string,
  ) {
    const where = entityName && slot ? `${entityName} [${slot}] ` : "";
    super(`${where}hook "${hookPath}" resolves to no function: ${detail}`);
    this.name = "UnresolvedHookError";
  }
}

/**
 * Raised when a hook module EXISTS but throws while importing — a syntax error, a
 * broken transitive import, a half-built `dist`. The import's own message is
 * carried in the text and the original error is kept as `cause`, because that
 * stack is the only thing that names the actual breakage; the entity and the slot
 * say which declaration stopped working because of it.
 */
export class HookModuleLoadError extends Error {
  constructor(
    public hookPath: string,
    public entityName: string,
    public slot: string,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${entityName} [${slot}] hook "${hookPath}" failed to load: ${reason}`, { cause });
    this.name = "HookModuleLoadError";
  }
}

/**
 * Services available to hook functions.
 * Hooks receive this as their third argument so they can do cross-entity
 * lookups (read a related parent during a child save, write a side-effect
 * doc on submit, etc.). Hooks that don't need these can ignore the argument.
 */
export interface HookServices {
  db: MongoDBService;
  registry: EntityRegistry;
  // documentService wired later via setter to avoid a circular import
  documentService?: unknown;
  /** Present during transactional lifecycle events (before_submit / on_submit /
   *  insert / update). Hook db calls MUST pass this session to participate. */
  session?: ClientSession;
  /** Params of the running action (dialog_fields values, job chunk _cursor).
   *  Only present during action:* hooks invoked with params. */
  actionParams?: Record<string, unknown>;
  /** The user context that triggered the surrounding lifecycle event.
   *  Present whenever DocumentService called the hook (insert / update /
   *  submit / cancel / delete / runAction). Hooks that spawn side-effect
   *  documents (e.g. an action creating a child doc, or on_submit posting a
   *  linked ledger entry) should pass this through to documentService.insert so
   *  audit trails reflect the real actor instead of an escalated "system" user. */
  user?: UserContext;
  /** True inside a `before_cancel` hook ONLY when the cancel is a cascade from a
   *  parent doc's cancel (it joined the parent's transaction via sessionOverride),
   *  not a direct API cancel. Lets a source-owned child (e.g. a doc's linked ledger
   *  entry) refuse a DIRECT cancel while still allowing the parent-cancel cascade. */
  cancelCascade?: boolean;
  /** Mint a signed on-behalf delegation token for the ACTING user, bound to
   *  `scope`, to drive a satellite service (e.g. render via digita-report). Present
   *  only on action hooks reached through the API (the engine holds the user's live
   *  JWT there). Throws loudly if AUTH_URL is unconfigured or no user token is
   *  available — no silent fallback. Keeps the raw JWT inside the engine. */
  mintDelegation?: (scope: DelegationScope) => Promise<string>;
}

// All hooks run SYNCHRONOUSLY and block the response: fire-and-forget / queued
// execution is NOT wired (JOBS_* env is reserved, inert — see config/env.ts).
// Hooks that spawn side-effect docs (e.g. an on_submit posting a ledger entry) do
// so inline via documentService.insert(), participating in the parent transaction's
// ClientSession, so the whole lifecycle commits or rolls back atomically.
type HookFunction = (
  doc: BaseDocument,
  ctx?: ResponseContext,
  services?: HookServices,
) => Promise<void> | void;

/** Merge per-call session + user into the platform-wide HookServices.
 *  Returns the unmodified base services when neither is supplied so we
 *  don't allocate a fresh object on every hook fire.
 */
function mergeServices(
  base: HookServices | undefined,
  session: ClientSession | undefined,
  user: UserContext | undefined,
): HookServices | undefined {
  if (!base) return base;
  if (!session && !user) return base;
  return { ...base, session: session ?? base.session, user: user ?? base.user };
}

export class HookRunner {
  private hooks: Map<string, Map<string, HookFunction>> = new Map();
  private moduleDirs: string[] = [];
  private loaded = false;
  private services?: HookServices;

  /** Inject platform services so hooks can do DB / registry / doc-service calls. */
  setServices(services: HookServices): void {
    this.services = services;
  }

  setDocumentService(documentService: unknown): void {
    if (this.services) this.services.documentService = documentService;
  }

  /** Public accessor — handy for tests / admin tooling. */
  getServices(): HookServices | undefined {
    return this.services;
  }

  /**
   * Load hook modules for all entities.
   * Hook paths are defined in entity.hooks and resolve to TypeScript modules.
   * @param moduleDirs — directories to search for hook modules (searched in order)
   */
  async loadHooks(entities: EntityDefinition[], moduleDirs?: string[]): Promise<void> {
    this.moduleDirs = moduleDirs ?? [env.MODULES_DIR];
    // Every declaration that resolves to no function, collected across ALL
    // entities and slots, so the report below names every one of them at once
    // instead of one per restart.
    const unresolved: string[] = [];

    for (const entity of entities) {
      if (!entity.hooks) continue;

      const entityHooks = new Map<string, HookFunction>();

      for (const [event, hookPath] of Object.entries(entity.hooks)) {
        if (!hookPath || typeof hookPath !== "string") continue;
        if (event === "on_field_change" || event === "computed") continue; // handled separately

        await this.registerHook(entityHooks, entity.name, event, hookPath, unresolved);
      }

      // Load field change hooks
      for (const [field, hookPath] of Object.entries(entity.hooks.on_field_change ?? {})) {
        await this.registerHook(
          entityHooks, entity.name, `on_field_change:${field}`, hookPath, unresolved,
        );
      }

      // Load computed field hooks
      for (const [field, hookPath] of Object.entries(entity.hooks.computed ?? {})) {
        await this.registerHook(
          entityHooks, entity.name, `computed:${field}`, hookPath, unresolved,
        );
      }

      // Load action handlers (one per `actions[].action` name).
      for (const [actionName, hookPath] of Object.entries(entity.hooks.actions ?? {})) {
        await this.registerHook(
          entityHooks, entity.name, `action:${actionName}`, hookPath, unresolved,
        );
      }

      if (entityHooks.size > 0) {
        this.hooks.set(entity.name, entityHooks);
      }
    }

    // One report over every entity, naming each open declaration with the module
    // directories that were searched, so a single log line is the whole picture.
    //
    // It stays a log and the engine starts. The cause is regularly OUTSIDE the
    // entity: a deploy drops a module and a reference nobody touched now points
    // at nothing. Entity definitions are read from MongoDB, so refusing to boot
    // would lock the tenant out of their own system with no way back in — the
    // engine UI that could fix the declaration is the thing that did not start.
    // A dead system is worse than a dead hook. What must not survive is the
    // SILENCE, and that is answered where it does damage: `registerHook` leaves
    // a marker in the slot, so the operation that needed the hook fails at the
    // call instead of completing as if the hook had run.
    if (unresolved.length > 0) {
      log.error(
        { count: unresolved.length, unresolved, dirs: this.moduleDirs },
        `${unresolved.length} hook declaration(s) resolve to no function — every ` +
          `entity.hooks entry must name a module found under one of the module ` +
          `directories (${this.moduleDirs.join(", ")}) that exports the named ` +
          `function. Every operation reaching one of these fails until it is ` +
          `fixed:\n${unresolved.join("\n")}`,
      );
    }

    this.loaded = true;
    log.info({ total_entities: this.hooks.size }, "Hooks loaded");
  }

  /**
   * Resolve one declaration and register it under `slot` — the same key
   * `run`, `runAction`, `runFieldChangeHooks` and `runComputedHooks` look up.
   *
   * A declaration that could not be turned into a function does NOT leave the
   * slot empty. An empty slot is indistinguishable from an entity that never
   * declared anything: the lookup misses, the caller returns, and the save,
   * submit or cancel the declaration was there to govern completes as if the
   * rules had run and passed. So the slot gets a marker instead — a function
   * that throws when the hook is reached, so the operation fails rather than
   * passing unchecked. The danger being closed is not the absent hook, it is the
   * write that went through as though it had been validated.
   *
   * Both failure kinds get that marker, and neither stops the boot: the system
   * stays available, the individual operation fails. The rule does not ask what
   * caused it — a check that did not run must not count as passed. What differs
   * is only what the caller is told, because the two need different fixes. A
   * declaration that resolves nowhere reports the reference and the directories
   * searched, and it can never repair itself: no module directory gains files at
   * runtime. A module that exists and throws while importing is a deploy defect
   * that the next deploy removes, so its marker carries the import's own message
   * and keeps the original error as `cause`, putting the stack that names the
   * syntax or import breakage in front of whoever hit it.
   */
  private async registerHook(
    entityHooks: Map<string, HookFunction>,
    entityName: string,
    slot: string,
    hookPath: string,
    unresolved: string[],
  ): Promise<void> {
    try {
      entityHooks.set(slot, await this.loadHookFunction(hookPath));
      log.debug({ entity: entityName, slot, path: hookPath }, "Hook loaded");
    } catch (err) {
      let marker: Error;
      if (err instanceof UnresolvedHookError) {
        // Re-raised with the entity and the slot, which only this level knows.
        // That one object is both the reported line and what the marker throws,
        // so the load report and the failing request read the same.
        marker = new UnresolvedHookError(hookPath, err.detail, entityName, slot);
        unresolved.push(`  - ${marker.message}`);
      } else {
        marker = new HookModuleLoadError(hookPath, entityName, slot, err);
        log.error(
          { entity: entityName, slot, path: hookPath, err },
          "Hook module failed to load — every operation reaching this hook fails until it is fixed",
        );
      }

      entityHooks.set(slot, () => {
        throw marker;
      });
    }
  }

  /**
   * Run a lifecycle hook for an entity.
   */
  async run(
    doctype: string,
    event: string,
    doc: BaseDocument,
    ctx?: ResponseContext,
    session?: ClientSession,
    user?: UserContext,
    extra?: Partial<HookServices>,
  ): Promise<void> {
    const entityHooks = this.hooks.get(doctype);
    if (!entityHooks) return;

    const fn = entityHooks.get(event);
    if (!fn) return;

    const merged = mergeServices(this.services, session, user);
    const services = extra && merged ? { ...merged, ...extra } : merged;

    try {
      await fn(doc, ctx, services);
      log.debug({ doctype, event, name: doc._id }, "Hook executed");
    } catch (err) {
      // A declared-4xx throw is an expected client-side rejection (surfaced as a
      // typed 4xx by the global error handler), not a server fault — log it at
      // warn to avoid false server alarms. Anything else stays at error.
      if (declaresClientError(err)) {
        log.warn({ doctype, event, name: doc._id, err }, "Hook execution failed");
      } else {
        log.error({ doctype, event, name: doc._id, err }, "Hook execution failed");
      }
      throw err; // Re-throw to abort the operation
    }
  }

  /**
   * Invoke an action handler by name. Returns whatever the handler returned
   * (typically a JSON-shaped descriptor of what was created/changed). When
   * no handler is registered for the action, returns `undefined` — the
   * action route then sends back the doc itself, mirroring the pre-handler
   * behaviour for actions that are effectively "no-op confirmations".
   */
  /** Whether a handler is registered for this meta-declared action — lets the
   *  caller distinguish a genuinely handler-less action (a config gap) from a
   *  handler that legitimately returns undefined. A declaration that FAILED to
   *  load counts as registered: it has a marker in the slot, so the failure comes
   *  from `runAction` naming the reference, not from the handler-less branch. */
  hasActionHandler(doctype: string, actionName: string): boolean {
    return this.hooks.get(doctype)?.has(`action:${actionName}`) ?? false;
  }

  async runAction(
    doctype: string,
    actionName: string,
    doc: BaseDocument,
    ctx?: ResponseContext,
    session?: ClientSession,
    user?: UserContext,
    params?: Record<string, unknown>,
    extraServices?: Partial<HookServices>,
  ): Promise<unknown> {
    const entityHooks = this.hooks.get(doctype);
    if (!entityHooks) return undefined;
    const fn = entityHooks.get(`action:${actionName}`);
    if (!fn) return undefined;

    let services = mergeServices(this.services, session, user);
    // Action params (dialog_fields values / job chunk cursor) travel on the
    // per-call services view - handlers read `services.actionParams`.
    if (params && Object.keys(params).length > 0) {
      services = { ...(services ?? {}), actionParams: params } as HookServices;
    }
    // Per-call capabilities the API layer supplies (e.g. mintDelegation bound to
    // the request's user JWT) — merged last so they ride the same services view.
    if (extraServices) {
      services = { ...(services ?? {}), ...extraServices } as HookServices;
    }

    try {
      const result = await fn(doc, ctx, services);
      log.debug({ doctype, action: actionName, name: doc._id }, "Action executed");
      return result;
    } catch (err) {
      // Same rationale as `run`: a declared-4xx throw is an expected client-side
      // rejection, not a server fault — log warn, else error.
      if (declaresClientError(err)) {
        log.warn({ doctype, action: actionName, name: doc._id, err }, "Action execution failed");
      } else {
        log.error({ doctype, action: actionName, name: doc._id, err }, "Action execution failed");
      }
      throw err;
    }
  }

  /**
   * Run field change hooks for changed fields. When called from inside a
   * transaction, pass the active `session` so hook DB writes participate in
   * the parent transaction.
   */
  async runFieldChangeHooks(
    doctype: string,
    doc: BaseDocument,
    changedFields: string[],
    ctx?: ResponseContext,
    session?: ClientSession,
    user?: UserContext,
  ): Promise<void> {
    const entityHooks = this.hooks.get(doctype);
    if (!entityHooks) return;

    const services = mergeServices(this.services, session, user);

    for (const field of changedFields) {
      const fn = entityHooks.get(`on_field_change:${field}`);
      if (fn) {
        await fn(doc, ctx, services);
      }
    }
  }

  /**
   * Run computed field hooks. Receives `services` (with optional `session`)
   * for parity with `run` and `runFieldChangeHooks`. Computed hooks are
   * usually pure but may do read-only DB lookups (e.g. resolve a linked
   * doc's price); the session keeps those reads consistent with the
   * surrounding transaction.
   *
   * When the same handler is registered for multiple computed fields
   * (e.g. one computeTotals function wired to subtotal + tax_amount +
   * grand_total), it runs ONCE per save, not N×. The dedupe is by
   * function reference — different handlers all run, in entity-JSON
   * insertion order. Most handlers naturally cover several fields in
   * one pass, so per-field invocation was wasteful (N× DB reads, N×
   * the same total math).
   */
  async runComputedHooks(
    doctype: string,
    doc: BaseDocument,
    ctx?: ResponseContext,
    session?: ClientSession,
    user?: UserContext,
  ): Promise<void> {
    const entityHooks = this.hooks.get(doctype);
    if (!entityHooks) return;

    const services = mergeServices(this.services, session, user);

    const seen = new Set<HookFunction>();
    for (const [key, fn] of entityHooks) {
      if (!key.startsWith("computed:")) continue;
      if (seen.has(fn)) continue;
      seen.add(fn);
      await fn(doc, ctx, services);
    }
  }

  private async loadHookFunction(hookPath: string): Promise<HookFunction> {
    // hookPath format: "module/entity/file.functionName"
    // e.g., "accounting/invoice/invoice.validate"
    const lastDot = hookPath.lastIndexOf(".");
    if (lastDot === -1) {
      throw new UnresolvedHookError(
        hookPath,
        'reference names no function — expected "<dir>/<file>.<exportedName>"',
      );
    }

    const modulePath = hookPath.slice(0, lastDot);
    const functionName = hookPath.slice(lastDot + 1);

    // Try each module directory × each plausible extension. tsx (dev) and
    // tsc-built dist (prod) need different extensions; rather than guess,
    // try `.ts` first then `.js`. Convert the absolute path to a file://
    // URL so dynamic import() works on Windows (Node ESM rejects raw
    // backslash paths in import specifiers).
    const extensions = [".ts", ".js"];
    // Every candidate that was tried, and every candidate that was there but
    // exported no such name — the two halves of the failure message below, so an
    // operator reads WHERE the engine looked instead of guessing the layout.
    const searched: string[] = [];
    const missingExport: string[] = [];
    for (const dir of this.moduleDirs) {
      for (const ext of extensions) {
        const fullPath = resolve(dir, `${modulePath}${ext}`);
        searched.push(fullPath);
        // A legitimately-absent candidate → try the next dir/ext. Checking the
        // file on disk (rather than discriminating the import() error code) is
        // deterministic and runtime-independent. Once the file EXISTS, any import
        // failure is a REAL breakage (syntax error, broken transitive import,
        // stale/half-built .js), and it is reported as that rather than as a
        // missing module, because the two need different fixes.
        if (!existsSync(fullPath)) continue;
        const importUrl = pathToFileURL(fullPath).href;
        try {
          const module = await import(importUrl);
          const fn = module[functionName];
          if (typeof fn === "function") {
            return fn as HookFunction;
          }
          // A later dir/ext may still export it (app dir overriding a core
          // module), so keep scanning; if none does, this list carries the
          // reason into the failure.
          missingExport.push(fullPath);
          log.warn(
            { path: fullPath, function: functionName },
            "Hook module loaded but function not exported",
          );
        } catch (err) {
          // Names the exact file that failed, which the caller's log cannot (it
          // holds the declaration, not the candidate that matched). Rethrown
          // unwrapped so `registerHook` can keep it as the marker's `cause`.
          log.error(
            { path: fullPath, function: functionName, err },
            "Hook module failed to load (broken import / syntax error)",
          );
          throw err;
        }
      }
    }

    // Nothing under any module directory answers this declaration. Report which
    // half failed — the file was never there, or it was there without the export
    // — because the two need different fixes.
    throw new UnresolvedHookError(
      hookPath,
      missingExport.length > 0
        ? `${missingExport.join(", ")} exports no "${functionName}"`
        : `no module file — searched: ${searched.join(", ")}`,
    );
  }
}
