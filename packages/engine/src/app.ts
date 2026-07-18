import { join } from "path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./core/config/env.js";
import { createLogger } from "./core/logging/logger.js";
import { MongoDBService } from "./core/database/mongodb-service.js";
import { registerAppDatabases } from "./core/database/app-db-discovery.js";
import { EntityRegistry } from "./core/entity/entity-registry.js";
import { DocumentService } from "./core/document/document-service.js";
import {
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  createCsrfMiddleware,
} from "./core/auth/auth-middleware.js";
import { RemoteAuthnAdapter } from "./core/auth/remote-authn-adapter.js";
import { callerIsInternal } from "./core/auth/audience.js";
import { TranslationService } from "./core/i18n/translation-service.js";
import { loadEngineI18n, engineI18n } from "./i18n.js";
import { LocaleResolver } from "./core/i18n/locale-resolver.js";
import { PermissionChecker } from "./core/permissions/permission-checker.js";
import { RoleRegistry, setRoleRegistry } from "./core/permissions/role-registry.js";
// seedAppData is invoked by the admin-reseed router and, when SEED_APP_DATA_ON_BOOT
// is set (dev convenience), once at boot from startup() below.
import { seedAppData } from "./core/setup/seed-app-data.js";
import { seedDataTranslations } from "./core/setup/seed-data-translations.js";
import { NamingService } from "./core/document/naming-service.js";
import { HookRunner } from "./core/hooks/hook-runner.js";
import { LinkValidator } from "./core/link/link-validator.js";
import { LinkTitleResolver } from "./core/link/link-title-resolver.js";
import { RealtimeService } from "./core/realtime/realtime-service.js";
import fastifyWebsocket from "@fastify/websocket";
import { SESSION_COOKIE } from "@digitaplatform/shared";
import { LinkSearchService } from "./core/link/link-search-service.js";
import { FetchFromResolver } from "./core/fetch/fetch-from-resolver.js";
import { SnapshotResolver } from "./core/snapshot/snapshot-resolver.js";
import { WorkflowEngine } from "./core/workflow/workflow-engine.js";
import { PeriodCloseValidator } from "./core/period/period-close-validator.js";
import { DeleteProtection } from "./core/link/delete-protection.js";
import { CancelProtection } from "./core/link/cancel-protection.js";
import { VersionService } from "./core/version/version-service.js";
import { ViewLogService } from "./core/version/view-log-service.js";
import { ActivityLogService } from "./core/logging/activity-log-service.js";
import { GlobalSearchService } from "./core/search/global-search-service.js";
import { ImportService } from "./core/import-export/import-service.js";
import { ExportService } from "./core/import-export/export-service.js";
import { BkResolver } from "./core/import-export/bk-resolver.js";
import { requestContextMiddleware } from "./core/api/middleware/request-context.js";
import {
  requestLoggerOnRequest,
  requestLoggerOnResponse,
  requestLoggerOnSend,
} from "./core/api/middleware/request-logger.js";
import { globalErrorHandler } from "./core/api/middleware/error-handler.js";
import { registerResourceRoutes } from "./core/api/resource-router.js";
import { registerPublicRoutes } from "./core/api/public-router.js";
import { registerMetaRoutes } from "./core/api/meta-router.js";
import { registerBootRoutes } from "./core/api/boot-router.js";
import { loadPluginConfig, type PluginRuntime } from "./core/plugins/plugin-config.js";
import { loadPluginEntitlements } from "./core/plugins/plugin-license.js";
import { readdirSync } from "node:fs";
import { registerPluginAssetRoutes } from "./core/api/plugin-assets-router.js";
import { registerTranslationRoutes } from "./core/api/translation-router.js";
import { registerSearchRoutes } from "./core/api/search-router.js";
import { registerSchemaDriftRoutes } from "./core/api/schema-drift-router.js";
import { registerAdminReseedRoutes } from "./core/api/admin-reseed-router.js";
import { registerAdminReloadDefinitionsRoutes } from "./core/api/admin-reload-definitions-router.js";
import type { DomainDirectory } from "./core/database/app-db-discovery.js";
import { registerActivityLogRoutes } from "./core/api/activity-log-router.js";
import { registerAuditLogRoutes } from "./core/api/audit-log-router.js";
import { registerImportExportRoutes } from "./core/api/import-export-router.js";
import { registerUploadRoutes } from "./core/api/upload-router.js";
import { createStoragePort } from "./core/storage/storage-factory.js";
import { registerSidebarRoutes } from "./core/api/sidebar-router.js";
import { RelatedDocService } from "./core/related/related-doc-service.js";
import { DocumentShareService } from "./core/permissions/document-share-service.js";
import { generateOpenAPISpec } from "./core/api/openapi-generator.js";
import { firstRun } from "./core/setup/first-run.js";
import { successResponse } from "./core/api/response-model.js";
import { RuleEngine } from "./core/rules/rule-engine.js";
import { seedRulesFromFiles } from "./core/rules/rule-loader.js";
import { ViewRegistry } from "./core/view/view-registry.js";
import { ViewEngine } from "./core/view/view-engine.js";
import { seedViewsFromFiles } from "./core/view/view-loader.js";
import { registerViewRoutes } from "./core/api/view-router.js";

const log = createLogger("app");

function parseBodyLimit(value: string): number {
  const match = value.match(/^(\d+)\s*(kb|mb|gb)?$/i);
  if (!match) return 10485760; // 10MB default
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

export async function createApp(
  opts: { authn?: import("./core/auth/authn-port.js").AuthnPort } = {},
) {
  const app = Fastify({
    logger: false,
    bodyLimit: parseBodyLimit(env.API_MAX_BODY_SIZE),
  });

  // ─── Core Services ─────────────────────────────────────

  const db = new MongoDBService();
  const registry = new EntityRegistry();
  // Engine-side auth boundary: verifies digita-auth's access tokens offline
  // via JWKS. The engine no longer issues tokens — login / refresh / logout /
  // 2FA / sessions all live in digita-auth.
  const authn = opts.authn ?? new RemoteAuthnAdapter();
  const translationService = new TranslationService(db);
  const localeResolver = new LocaleResolver(db);
  // File storage backend (local disk | S3/Garage) — fails boot in production
  // when UPLOAD_STORAGE=s3 is configured incompletely.
  const storage = createStoragePort();

  // ─── Document Engine Services ──────────────────────────

  const hookRunner = new HookRunner();
  hookRunner.setServices({ db, registry });
  const versionService = new VersionService(db);
  const viewLogService = new ViewLogService(db);
  const permissionChecker = new PermissionChecker(registry);
  const roleRegistry = new RoleRegistry(db);
  setRoleRegistry(roleRegistry);
  const linkValidator = new LinkValidator(registry, db);
  const linkTitleResolver = new LinkTitleResolver(registry, db, translationService);
  const realtimeService = new RealtimeService(permissionChecker);
  const fetchFromResolver = new FetchFromResolver(registry, db);
  const snapshotResolver = new SnapshotResolver(registry, db);
  // RuleEngine is constructed below; late-bind to avoid forward reference.
  const workflowEngine = new WorkflowEngine(registry);
  // Late-bind state override resolution so per-state permission strips
  // (`state.permissions: [{ role, read?:0, write?:0, ... }]`) are enforced
  // server-side, not just FE-side.
  permissionChecker.setWorkflowEngine(workflowEngine);
  const periodCloseValidator = new PeriodCloseValidator(registry, db);
  const deleteProtection = new DeleteProtection(registry, db);
  const cancelProtection = new CancelProtection(registry, db);
  const activityLogService = new ActivityLogService(db);
  const ruleEngine = new RuleEngine(db, registry);

  // ─── DocumentService (fully wired) ─────────────────────

  const documentService = new DocumentService({
    registry,
    db,
    permissionChecker,
    hookRunner,
    linkValidator,
    linkTitleResolver,
    fetchFromResolver,
    snapshotResolver,
    workflowEngine,
    periodCloseValidator,
    deleteProtection,
    cancelProtection,
    versionService,
    viewLogService,
    translationService,
    activityLogService,
    ruleEngine,
    storage,
  });
  // Allow hooks to spawn related documents transactionally (e.g. side-effect docs on submit).
  hookRunner.setDocumentService(documentService);
  ruleEngine.setDocumentService(documentService);
  workflowEngine.setRuleEngine(ruleEngine);

  // Late-bound by startup() — read by admin reseed / reload routes
  // at request time. Empty until startup discovers the app domains
  // and computes the source-dir lists.
  let discoveredDomainDirs: DomainDirectory[] = [];
  let discoveredEntityDirs: string[] = [];
  let discoveredLocaleDirs: string[] = [];
  // App-declared frontend plugin composition (selection + opaque placement).
  // Populated during startup(); read late by the plugin-manifest route via the
  // variable's current value.
  let pluginRuntime: PluginRuntime = { plugins: [], layout: null, audiences: {} };
  // Premium plugin entitlements from the offline-verified license
  // (claims.plugins). Populated during startup(); [] until then and whenever
  // the license is missing/invalid/expired (fail-closed — premium stays
  // locked, boot never crashes over licensing).
  let pluginEntitlements: string[] = [];

  // ─── Declarative View Engine ───────────────────────────

  const viewRegistry = new ViewRegistry();
  const viewExecutor = new ViewEngine({
    documentService,
    db,
    registry,
    permissionChecker,
  });

  // ─── API-level Services ────────────────────────────────

  const bkResolver = new BkResolver(registry, db);
  const importService = new ImportService(
    documentService,
    registry,
    db,
    permissionChecker,
    linkValidator,
    bkResolver,
  );
  const exportService = new ExportService(documentService, registry, bkResolver);
  const globalSearchService = new GlobalSearchService(registry, db, permissionChecker);
  const linkSearchService = new LinkSearchService(registry, db, permissionChecker);
  const relatedDocService = new RelatedDocService(registry, db, permissionChecker);
  const documentShareService = new DocumentShareService(db);

  // ─── Global Middleware ─────────────────────────────────

  // helmet must come before CORS so its headers land on preflight responses.
  await app.register(helmet, {
    // CSP: permissive in dev for Vite HMR (inline + ws), tightened for prod.
    // admin-frontend consumes the API from a same-origin proxy, so default-src
    // 'self' is safe. Swagger-UI needs unsafe-inline scripts + data: images.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    strictTransportSecurity: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: false,
    },
    xFrameOptions: { action: "deny" },
    xContentTypeOptions: true,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: env.CORS_CREDENTIALS,
  });

  // Session transport: read request.cookies (httpOnly access token + CSRF).
  // Unsigned — the JWT inside is the security; the cookie is just the carrier.
  await app.register(cookie);

  // Opt-out limiter: setting API_RATE_LIMIT_MAX <= 0 disables rate limiting
  // entirely (used by disposable test/load tenants like the `e2e` tenant, where
  // a fixture burst from a single identity would otherwise 429). Production keeps
  // the default 1000/min per identity.
  if (env.API_RATE_LIMIT_MAX > 0) {
    await app.register(rateLimit, {
      max: env.API_RATE_LIMIT_MAX,
      timeWindow: env.API_RATE_LIMIT_WINDOW,
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
    });
  }

  await app.register(multipart, {
    limits: { fileSize: parseBodyLimit(env.UPLOAD_MAX_SIZE) },
  });

  // ─── Swagger / OpenAPI ──────────────────────────────────

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Digita Platform API",
        description: "Auto-generated REST API from entity definitions",
        version: env.APP_VERSION,
      },
      servers: [{ url: env.BASE_URL }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });

  app.addHook("onRequest", requestContextMiddleware);
  app.addHook("onRequest", requestLoggerOnRequest);
  app.addHook("onResponse", requestLoggerOnResponse);
  app.addHook("onSend", requestLoggerOnSend);

  // Server-side i18n: translate message KEYS in any ApiResponse to the request
  // locale (user.language → Accept-Language → fallback), then drop the transient
  // params. Single central point — handlers just push keys into the context.
  app.addHook("preSerialization", async (request, _reply, payload) => {
    const body = payload as { messages?: import("@digitaplatform/shared").ResponseMessage[] } | null;
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return payload;
    const i18n = engineI18n();
    const userLang = (request.user as { language?: string } | undefined)?.language;
    const locale =
      userLang && i18n.supported.includes(userLang)
        ? userLang
        : i18n.resolveLocale(request.headers["accept-language"]);
    for (const m of body.messages) {
      m.text = i18n.t(m.text, m.params, locale);
      delete m.params;
    }
    return payload;
  });

  app.setErrorHandler(globalErrorHandler);

  // ─── Auth Middleware ───────────────────────────────────

  const authenticate = createAuthMiddleware(authn);
  const optionalAuth = createOptionalAuthMiddleware(authn);
  // CSRF double-submit for cookie-authenticated mutations (Bearer is exempt).
  const csrf = createCsrfMiddleware();

  // ─── Public Routes (no auth) ──────────────────────────

  app.get("/health", async (_req, reply) => {
    return reply.send(successResponse({ status: "ok", version: env.APP_VERSION }));
  });

  // Login / refresh / logout / 2FA are served by digita-auth, not the engine.

  // ─── Boot (optional auth) ─────────────────────────────

  app.register(async (scope) => {
    scope.addHook("onRequest", optionalAuth);
    // getAudiences is a GETTER (not the value): pluginRuntime is reassigned
    // wholesale in startup() AFTER this registers, so the closure must read it lazily.
    registerBootRoutes(scope, env.API_PREFIX, db, localeResolver, () => pluginRuntime.audiences);
  });

  // ─── Public read (optional auth → Guest) ──────────────
  // Generic, content-agnostic anonymous READ surface. An unauthenticated caller
  // is treated as the built-in Guest role; an entity is reachable ONLY if it
  // grants Guest read in its own permissions (e.g. the web-CMS content entities).
  // Read-only; no engine knowledge of "websites".
  app.register(async (scope) => {
    scope.addHook("onRequest", optionalAuth);
    registerPublicRoutes(scope, env.API_PREFIX, { db, documentService, permissionChecker, storage, localeResolver });
  });

  // ─── Protected utility routes (auth required) ─────────

  app.register(async (scope) => {
    scope.addHook("onRequest", authenticate);

    // OpenAPI spec — whole-platform schema (entities, fields, perms). P-SEC/R3:
    // gate to the INTERNAL audience so an authenticated external user can't
    // enumerate the internal schema (authenticated ≠ trusted operator anymore).
    scope.get(`${env.API_PREFIX}/openapi.json`, async (request, reply) => {
      if (!callerIsInternal(request.user)) {
        return reply.code(403).send({ success: false, error: { code: "FORBIDDEN" } });
      }
      const spec = generateOpenAPISpec(registry, env.API_PREFIX);
      return reply.send(spec);
    });
  });

  // ─── Protected Routes (auth required) ─────────────────

  app.register(async (scope) => {
    scope.addHook("onRequest", authenticate);
    scope.addHook("onRequest", csrf);

    // Frontend plugin COMPOSITION — which plugins the app enables (id +
    // optional title, from the merged app-declared plugins.config.json), the
    // opaque placement layout, and the tenant's premium ENTITLEMENTS (the
    // verified license's claims.plugins; [] without a valid license). The
    // engine does NOT interpret the layout and hands out NO asset URLs here:
    // the host joins this list by id with the static inventory at
    // /plugins/index.json and loads each plugin by TYPE from the inventory's
    // url (free = nginx static under /plugins/…, premium = the engine-gated
    // /plugin-assets route below; a premium id outside `entitlements` is shown
    // locked and its bytes are never fetched). Empty until an app enables
    // plugins; the host renders fine with none.
    scope.get(`${env.API_PREFIX}/plugins`, async (_request, reply) => {
      return reply.send(
        successResponse({
          plugins: pluginRuntime.plugins.map((p) => ({
            id: p.id,
            title: p.title,
          })),
          layout: pluginRuntime.layout ?? undefined,
          entitlements: pluginEntitlements,
        }),
      );
    });

    // Premium plugin artifacts — engine-gated static delivery from
    // PLUGINS_PREMIUM_DIR. 403 for any :id outside the verified entitlements
    // (bytes never leave the server); path-traversal-safe; immutable cache
    // (artifacts are version-addressed). Lazy getters: entitlements load in
    // startup() after routes register, and the env key may be absent (tests
    // that mock the whole env object) ⇒ 404s, never a crash.
    registerPluginAssetRoutes(scope, env.API_PREFIX, {
      getEntitlements: () => pluginEntitlements,
      getPremiumDir: () => env.PLUGINS_PREMIUM_DIR,
    });

    registerMetaRoutes(scope, env.API_PREFIX, registry, db, permissionChecker);
    registerResourceRoutes(scope, env.API_PREFIX, registry, documentService, localeResolver, realtimeService);
    registerTranslationRoutes(scope, env.API_PREFIX, translationService);
    registerSearchRoutes(scope, env.API_PREFIX, globalSearchService, linkSearchService);
    registerSchemaDriftRoutes(scope, env.API_PREFIX, registry, db);
    registerAdminReseedRoutes(scope, env.API_PREFIX, {
      db,
      registry,
      translationService,
      appDirs: env.APP_DIRS,
      // Late-binding: domainDirs is populated during startup(), but
      // the route is registered earlier in createApp(). Resolved at
      // request time via this getter.
      getDomainDirs: () => discoveredDomainDirs,
    });
    registerAdminReloadDefinitionsRoutes(scope, env.API_PREFIX, {
      db,
      registry,
      viewRegistry,
      translationService,
      roleRegistry,
      appDirs: env.APP_DIRS,
      getEntityDirs: () => discoveredEntityDirs,
      getLocaleDirs: () => discoveredLocaleDirs,
      getDomainDirs: () => discoveredDomainDirs,
    });
    registerActivityLogRoutes(scope, env.API_PREFIX, activityLogService, documentService);
    registerAuditLogRoutes(scope, env.API_PREFIX, versionService);
    registerImportExportRoutes(scope, env.API_PREFIX, importService, exportService, permissionChecker, registry);
    registerUploadRoutes(scope, env.API_PREFIX, db, storage, registry, permissionChecker);
    registerSidebarRoutes(
      scope,
      env.API_PREFIX,
      registry,
      relatedDocService,
      versionService,
      documentShareService,
      documentService,
      permissionChecker,
    );
    registerViewRoutes(scope, env.API_PREFIX, viewRegistry, viewExecutor);
  });

  // ─── Real-time WebSocket gateway ──────────────────────
  // Lean model: after a committed write the resource layer broadcasts a
  // {entity,name,op} event; subscribed clients invalidate their caches and
  // re-fetch (re-fetch stays permission-gated by the resource API). The handshake
  // is authenticated from the httpOnly cookie (or Bearer/?token= for non-browser).
  if (env.REALTIME_ENABLED) {
    // Encapsulated + AWAITED register: the plugin's onRoute hook (which wires
    // `{websocket:true}`) must be active BEFORE the route is added, else the route
    // is treated as a plain GET and the upgrade fails. This is the canonical order.
    app.register(async (instance) => {
      await instance.register(fastifyWebsocket);
      instance.get(env.WS_PATH, { websocket: true }, async (socket, request) => {
        // Authenticate the handshake (httpOnly cookie rides the upgrade; Bearer +
        // ?token= for non-browser clients). Reject invalid sockets.
        const cookieTok = request.cookies?.[SESSION_COOKIE.ACCESS];
        const authHeader = request.headers.authorization;
        const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
        const queryTok = (request.query as Record<string, string> | undefined)?.["token"];
        const token = cookieTok ?? bearer ?? queryTok;
        let user;
        try {
          if (!token) throw new Error("no token");
          user = (await authn.verifyAccessToken(token)).user;
        } catch {
          socket.close(1008, "unauthorized");
          return;
        }
        const client = realtimeService.add(socket, user);
        const ping = setInterval(() => {
          try {
            socket.ping();
          } catch {
            /* socket already gone */
          }
        }, env.WS_PING_INTERVAL_MS);
        const cleanup = () => {
          clearInterval(ping);
          realtimeService.remove(client);
        };
        socket.on("close", cleanup);
        socket.on("error", cleanup);
        // The client declares the entities it is currently viewing; only those
        // receive change events (targeted, no system-wide noise).
        socket.on("message", (raw: unknown) => {
          try {
            const msg = JSON.parse(String(raw)) as { type?: string; entities?: unknown };
            if (msg.type === "subscribe" && Array.isArray(msg.entities)) {
              const entities = msg.entities.filter((e): e is string => typeof e === "string");
              realtimeService.subscribe(client, entities);
              socket.send(JSON.stringify({ type: "subscribed", entities }));
            }
          } catch {
            /* ignore malformed client message */
          }
        });
        socket.send(JSON.stringify({ type: "ready" }));
      });
    });
  }

  // ─── Startup Sequence ─────────────────────────────────

  const startup = async () => {
    const startTime = Date.now();
    log.info({ env: env.NODE_ENV, version: env.APP_VERSION }, "Starting Digita Platform");

    // 1. Connect to MongoDB
    await db.connect();

    // 1a. Load static system-message i18n (shared translator) from file locales.
    await loadEngineI18n();

    // 2. Build app directory lists (APP_DIRS or fallback to legacy single dirs).
    //    Platform core entities (env.ENTITIES_DIR / MODULES_DIR / LOCALES_DIR)
    //    are loaded UNCONDITIONALLY — they declare the user/role/translation/
    //    session entities that the rest of the platform depends on. APP_DIRS
    //    are loaded after so they can override core entities by name if needed.
    const useAppDirs = env.APP_DIRS.length > 0;
    const entityDirs = useAppDirs
      ? [env.ENTITIES_DIR, ...env.APP_DIRS.map((d) => join(d, "entities"))]
      : [env.ENTITIES_DIR];
    const moduleDirs = useAppDirs
      ? [env.MODULES_DIR, ...env.APP_DIRS.map((d) => join(d, "modules"))]
      : [env.MODULES_DIR];
    const localeDirs = useAppDirs
      ? [env.LOCALES_DIR, ...env.APP_DIRS.map((d) => join(d, "locales"))]
      : [env.LOCALES_DIR];
    discoveredEntityDirs = entityDirs;
    discoveredLocaleDirs = localeDirs;

    // 2b. Discover domain databases under each app dir. Convention: any
    //     subfolder containing an `entities/` directory is its own database
    //     called `<appname>_<sub>` (e.g. `<app>/master/entities/` → `<app>_master`).
    //     Each is registered with the MongoDB service and gets its own
    //     entity-load pass with the matching default database name.
    const domainDirs = useAppDirs ? await registerAppDatabases(db, env.APP_DIRS) : [];
    discoveredDomainDirs = domainDirs;

    // 3. Load entity definitions from all app directories.
    //    First the legacy flat `<appdir>/entities/` (database = "app"),
    //    then the per-domain `<appdir>/<sub>/entities/` (database = "<app>_<sub>").
    for (const dir of entityDirs) {
      await registry.loadAll(dir);
    }
    for (const d of domainDirs) {
      await registry.loadAll(join(d.root, "entities"), { defaultDatabase: d.dbName });
    }

    // 3b. Domain folders contribute to the same module/locale/seed dir lists.
    //     The downstream loaders are dir-array-aware already, so a missing
    //     folder is simply skipped.
    for (const d of domainDirs) {
      moduleDirs.push(join(d.root, "modules"));
      localeDirs.push(join(d.root, "locales"));
    }

    // 4. Run first-time setup (seed data, migrate schemas)
    await firstRun(db, registry, translationService);

    // 4b. The canonical app-data seeder is the admin reseed endpoint, not boot.
    //     `<appDir>/<domain>/seeds/*.seed.json` (reference/config data every
    //     install needs — incl. any mandatory is_single config the app declares)
    //     and `<appDir>/<domain>/seeds-demo/` (showcase records + transactional
    //     demos) load on-demand via `POST /api/v1/admin/reseed` (modes:
    //     `template` / `demo`). The opt-in boot seed (4b-bis) loads each tier under
    //     its own flag (dev convenience). Boot itself produces a consistent baseline of platform
    //     metadata + auth essentials (admin user, platform-built-in Roles,
    //     Languages, SystemSettings, entity definitions).

    // 4b-bis. DEV CONVENIENCE (opt-in): seed app data at boot so a local DB wipe +
    //     restart self-heals. Two INDEPENDENT tiers, each with its own flag:
    //       SEED_APP_DATA_ON_BOOT  → reference tier (`seeds/`: roles, lookups,
    //                                fiscal calendar, nav, mandatory singles)
    //       SEED_DEMO_DATA_ON_BOOT → demo tier (`seeds-demo/`: customers, products,
    //                                sample documents)
    //     Reference is loaded before demo (demo rows reference reference data). Both
    //     default OFF → production never auto-seeds (reseed-only). Runs before
    //     RoleRegistry.load() so seeded app roles are present. Always auto/non-
    //     destructive — fills an empty DB, skips existing rows; reset = reseed API.
    if (env.SEED_APP_DATA_ON_BOOT || env.SEED_DEMO_DATA_ON_BOOT) {
      const seedDirs: string[] = [];
      if (env.SEED_APP_DATA_ON_BOOT) {
        seedDirs.push(
          ...env.APP_DIRS.map((d) => join(d, "seeds")),
          ...domainDirs.map((d) => join(d.root, "seeds")),
        );
      }
      if (env.SEED_DEMO_DATA_ON_BOOT) {
        seedDirs.push(
          ...env.APP_DIRS.map((d) => join(d, "seeds-demo")),
          ...domainDirs.map((d) => join(d.root, "seeds-demo")),
        );
      }
      // Dev convenience — a seed problem must NEVER brick the engine. Log loudly
      // and continue; the destructive reseed endpoint is the path that surfaces
      // seed errors hard.
      try {
        await seedAppData(db, registry, new NamingService(db), seedDirs);
        // Co-located per-document data translations (e.g. chart-of-accounts names
        // in de/fr/it/…) so seeded data follows each user's UI language.
        await seedDataTranslations(db, registry, translationService, seedDirs);
        log.info(
          {
            reference: env.SEED_APP_DATA_ON_BOOT,
            demo: env.SEED_DEMO_DATA_ON_BOOT,
            dirs: seedDirs.length,
          },
          "App data seeded at boot — dev convenience, not for prod",
        );
      } catch (e) {
        log.error(
          { err: (e as Error).message },
          "Boot app-data seed failed (non-fatal) — continuing startup",
        );
      }
    }

    // 4c. Load RoleRegistry from the seeded Role collection.
    //     Boot sees only platform-built-in roles (Administrator / System
    //     User / Website User / Guest); app-specific roles (Sales
    //     Manager, Buyer, etc.) arrive via the wizard's reseed call.
    //     Permission validation is therefore softened: unknown roles
    //     log warnings rather than throwing, so the system stays
    //     bootable before the wizard runs.
    await roleRegistry.load();
    for (const entity of registry.getAll()) {
      for (let i = 0; i < (entity.permissions ?? []).length; i++) {
        const perm = entity.permissions![i]!;
        if (!roleRegistry.has(perm.role)) {
          log.warn(
            { entity: entity.name, role: perm.role, index: i },
            "entity references role not yet seeded — run wizard reseed to populate app roles",
          );
        }
      }
    }

    // 5. Reload entity definitions from MongoDB (DB is the runtime source of truth)
    await registry.loadFromDb(db);

    // 5b. Snapshot coverage audit — every Link on a submittable entity
    //     should declare a freeze directive (`freeze: true | false |
    //     string[] | { ... }`) so submitted documents are self-contained
    //     per the document-DB principle. Reports gaps as warnings.
    //     See docs/guides/10-foreign-keys.md.
    const freezeGaps = registry.auditFreezeCoverage();
    if (freezeGaps.length > 0) {
      log.warn(
        { count: freezeGaps.length, gaps: freezeGaps.slice(0, 50) },
        `Snapshot coverage audit: ${freezeGaps.length} unfrozen Link(s) on submittable entities — submitted docs may leak live master data`,
      );
    } else {
      log.info("Snapshot coverage audit: all submittable Links carry an explicit freeze directive");
    }

    // 5b2. Scope-enforcement audit — permission.scope declarations are inert
    //      while PERMISSION_SCOPE_ENABLED is off: the affected role sees ALL
    //      rows. Name every declaration so the gap is a visible decision
    //      (end-to-end enforcement is the wired-integrity round's headline).
    const unenforcedScopes = registry.auditUnenforcedScopes(env.PERMISSION_SCOPE_ENABLED);
    if (unenforcedScopes.length > 0) {
      log.warn(
        { count: unenforcedScopes.length, scopes: unenforcedScopes.slice(0, 50) },
        `Scope audit: ${unenforcedScopes.length} permission.scope declaration(s) are NOT enforced (PERMISSION_SCOPE_ENABLED=false) — affected roles see unscoped data`,
      );
    }

    // 5c. Attach storage-path lint — uploads are entity-scoped by design
    //     (key = `<storage_path>/<uuid><ext>`; NO default folder, NO
    //     bucket-root fallback). Unlike the freeze audit above, this one is
    //     a HARD failure: an entity with Attach/AttachImage fields but no
    //     (or an invalid) storage_path would make every upload against it
    //     un-attributable, so the gap must be caught at boot, not at the
    //     first upload request.
    const storagePathOffenders = registry.auditAttachStoragePaths();
    if (storagePathOffenders.length > 0) {
      const detail = storagePathOffenders
        .map((o) => `  - ${o.entity}: ${o.problem}`)
        .join("\n");
      log.fatal(
        { count: storagePathOffenders.length, offenders: storagePathOffenders },
        "Attach storage-path lint FAILED — refusing to boot",
      );
      throw new Error(
        `Attach storage-path lint failed for ${storagePathOffenders.length} ` +
          `entity definition(s) — every entity with Attach/AttachImage fields must ` +
          `declare a valid top-level "storage_path":\n${detail}`,
      );
    }
    log.info(
      "Attach storage-path lint passed — every Attach/AttachImage entity declares a valid storage_path",
    );

    // 5d. Load app-declared frontend plugin composition (selection + placement)
    //     from each <appDir>/plugins.config.json. Opaque relay only — the engine
    //     never interprets the layout. Fail-loud on malformed config (in
    //     loadPluginConfig).
    pluginRuntime = useAppDirs
      ? await loadPluginConfig(env.APP_DIRS)
      : { plugins: [], layout: null, audiences: {} };
    log.info(
      { plugins: pluginRuntime.plugins.map((p) => p.id) },
      "Frontend plugin composition configured",
    );

    // 5e. Verify the plugin license OFFLINE (EdDSA, jose) and extract the
    //     premium entitlements (claims.plugins) for the composition endpoint
    //     and the gated /plugin-assets delivery. Fail-closed by construction:
    //     loadPluginEntitlements never throws — a missing/invalid/expired
    //     license yields [] (premium locked), never a boot failure.
    pluginEntitlements = await loadPluginEntitlements();
    // TEMPORARY (PLUGINS_LICENSE_DISABLED, default ON — remove when the plugin
    // store ships): with no marketplace/license yet, entitle EVERY plugin
    // physically staged under PLUGINS_PREMIUM_DIR so all delivered designs are
    // usable ungated. Self-limiting — only what is actually staged is opened. The
    // license loader, the /api/v1/plugin-assets 403 gate, and the client gate are
    // all left untouched; flipping the flag off re-arms them over the same bytes.
    if (env.PLUGINS_LICENSE_DISABLED) {
      let staged: string[] = [];
      try {
        staged = readdirSync(env.PLUGINS_PREMIUM_DIR, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        /* premium dir absent (nothing staged) — nothing to entitle */
      }
      pluginEntitlements = [...new Set([...pluginEntitlements, ...staged])];
      log.warn(
        `TEMPORARY: plugin license gating disabled (PLUGINS_LICENSE_DISABLED) — entitling all ${staged.length} staged premium plugin(s): ${staged.join(", ") || "(none)"}`,
      );
    }

    // 6. Load hook modules from all app directories
    await hookRunner.loadHooks(registry.getAll(), moduleDirs);

    // 6b. Seed DocumentActionRule entries from `<appDir>/rules/*.rule.json`
    //     and `<appDir>/<domain>/rules/*.rule.json`. Admin overrides preserved.
    if (useAppDirs) {
      const ruleDirs = [...env.APP_DIRS, ...domainDirs.map((d) => d.root)];
      await seedRulesFromFiles(db, ruleDirs, registry);
    }

    // 6c. Seed DocumentView entries from `<appDir>/views/**.view.json`
    //     and `<appDir>/<domain>/views/**.view.json`.
    //     Admin-overridden views are preserved unless VIEW_FORCE includes their id or "*".
    if (useAppDirs) {
      const viewDirs = [...env.APP_DIRS, ...domainDirs.map((d) => d.root)];
      await seedViewsFromFiles(db, viewDirs, viewRegistry, new Set(env.VIEW_FORCE));
    }
    await viewRegistry.loadFromDb(db);

    // 7. Initialize locale resolver
    await localeResolver.initialize();

    // 8. Preload translations for default locale
    for (const dir of localeDirs) {
      if (env.TRANSLATION_SEED_ON_BOOT) {
        await translationService.seedFromFiles(dir);
      }
    }

    // 8b. Auto-seed option translation placeholders for every Select field
    if (env.TRANSLATION_SEED_ON_BOOT) {
      await translationService.seedOptionTranslationsFromEntities(
        registry.getAll() as unknown as {
          name: string;
          fields: { fieldname: string; fieldtype?: string; options?: unknown }[];
        }[],
        env.TRANSLATION_FALLBACK_LOCALE,
      );
    }

    await translationService.loadTranslationsForLocale(localeResolver.getDefaultLanguage());

    // Demo orchestrator is NOT triggered at boot — see admin reseed
    // endpoint (registered below) which the setup wizard calls.

    log.info({ duration_ms: Date.now() - startTime }, "Startup completed");
  };

  // `registry` + `hookRunner` are exposed for tests (register fixture entities
  // and their hooks after startup) and diagnostics — production callers only
  // need app/startup/db.
  return { app, startup, db, registry, hookRunner };
}
