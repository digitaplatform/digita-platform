import { config } from "dotenv";
import { resolve, dirname, join } from "path";
import { readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dbName } from "./db-names.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve monorepo root — works from both src/ (tsx dev) and dist/ (compiled)
// "core" here is a literal filesystem path segment, NOT the digita database
// target. Don't replace with DIGITA.DATABASES.CORE.
const isCompiled =
  !__dirname.includes(`${["", "src", "core", "config"].join("/")}`) &&
  !__dirname.includes(`${["", "src", "core", "config"].join("\\")}`);
// Both src/core/config and dist/core/config sit 5 levels below the monorepo
// root under the packages/engine/ nesting (packages/engine/src/core/config →
// repo root is 5 up; the former flat digita-engine/ layout needed only 4 —
// a stale path here makes dev silently skip .env.development).
const monorepoRoot = resolve(__dirname, "../../../../../");

// Default platform-internal asset roots track where the runtime is loaded
// from. tsx (dev) loads .ts files in src/, node (prod) loads .js in dist/.
// Both copies of `entities/` and `locales/` exist after a build (tsc copies
// .json files via its includes; we still keep them in src for dev). Allow
// env overrides for non-standard layouts.
const platformAssetRoot = isCompiled ? "./dist" : "./src";

// Load .env file based on NODE_ENV
const envFile =
  process.env["NODE_ENV"] === "production"
    ? ".env"
    : `.env.${process.env["NODE_ENV"] || "development"}`;

config({ path: resolve(monorepoRoot, envFile) });
config({ path: resolve(monorepoRoot, ".env") });

// ─── Helpers ─────────────────────────────────────────────

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function getEnvRequired(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function getEnvInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${val}`);
  }
  return parsed;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === "") return fallback;
  return val === "true" || val === "1";
}

function getEnvArray(key: string, fallback: string[]): string[] {
  const val = process.env[key];
  if (!val) return fallback;
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Expand each "apps root" in APPS_DIRS into the list of its immediate app
// subdirectories. This makes app loading DYNAMIC: adding a new app is just
// dropping a folder into the root (locally the sibling digita-apps/apps
// checkout, in the cluster the mounted app bundle) — no per-app config
// anywhere. Boot-time sync scan; missing/unreadable roots and dotfile /
// node_modules entries are skipped silently. Paths stay relative to the
// engine cwd, exactly like the explicit APP_DIRS entries.
function discoverAppDirs(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root, { withFileTypes: true })
        .filter(
          (e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules",
        )
        .map((e) => e.name)
        .sort();
    } catch {
      continue; // root does not exist / not readable → contribute nothing
    }
    for (const name of names) out.push(join(root, name));
  }
  return out;
}

// ─── Tenant-aware reserved database names ────────────────
// Many customer deployments share ONE MongoDB cluster. Every physical DB name is
// composed as `digita_<guid>_<app>_<role|domain>` (see db-names.ts) from the
// prefix, a per-customer immutable GUID (TENANT_ID), the app-type (APP_NAME), and
// the logical role/domain. DBs stay keyed by the GUID, never by the mutable
// subdomain — a rename never touches a DB. Empty TENANT_ID/APP_NAME drop out, so
// local dev/tests keep the legacy unprefixed names (digita_core, …) unchanged.
// INSTANCE_ID is the legacy alias for APP_NAME (former scheme: INSTANCE_ID=<app> →
// digita_erp_core); honoured during the migration to TENANT_ID + APP_NAME.
const appDbPrefix = getEnv("MONGODB_APP_DB_PREFIX", "digita");
const tenantId = getEnv("TENANT_ID", "");
const appName = getEnv("APP_NAME", "") || getEnv("INSTANCE_ID", "");
// Environment postfix (dev/test/prod) appended LAST to every physical DB name so a
// tenant's DBs are distinguishable per stage; empty (local dev/tests) drops out.
const stage = getEnv("STAGE", "");
const reservedDb = (role: string): string => dbName(appDbPrefix, tenantId, appName, role, stage);

// ─── Environment Configuration ───────────────────────────

export const env = {
  // ─── APP ──────────────────────────────────────────────
  NODE_ENV: getEnv("NODE_ENV", "development"),
  // Destructive app-data reseed (/admin/reseed) is disabled in production
  // unless explicitly allowed, so it can't be triggered accidentally live.
  ALLOW_DESTRUCTIVE_RESEED: getEnvBool("ALLOW_DESTRUCTIVE_RESEED", false),
  APP_VERSION: getEnv("APP_VERSION", "0.1.0"),
  SERVICE_NAME: getEnv("SERVICE_NAME", "digita-platform"),
  PORT: getEnvInt("PORT", 3000),
  HOST: getEnv("HOST", "0.0.0.0"),
  BASE_URL: getEnv("BASE_URL", "http://localhost:3000"),

  // ─── TENANT / APP ─────────────────────────────────────
  // TENANT_ID = per-customer immutable GUID; APP_NAME = app-type. Together they
  // namespace every DB as digita_<guid>_<app>_<role|domain> (see reservedDb above).
  // Empty = legacy single-tenant names. INSTANCE_ID is the legacy APP_NAME alias.
  TENANT_ID: tenantId,
  APP_NAME: appName,
  INSTANCE_ID: appName,
  STAGE: stage,

  // ─── MONGODB ──────────────────────────────────────────
  MONGODB_URI: getEnvRequired("MONGODB_URI"),
  // Identity is owned by digita-auth now (engine has no User entity); this
  // binding is vestigial. Per-tenant by default: digita_<guid>_<app>_auth.
  MONGODB_IDENTITY_DB: getEnv("MONGODB_IDENTITY_DB", dbName(appDbPrefix, tenantId, appName, "auth", stage)),
  // core/logs/audits are per-instance → default to ${prefix}_${INSTANCE_ID}_<role>.
  MONGODB_LOGS_DB: getEnv("MONGODB_LOGS_DB", reservedDb("logs")),
  MONGODB_AUDITS_DB: getEnv("MONGODB_AUDITS_DB", reservedDb("audits")),
  MONGODB_CORE_DB: getEnv("MONGODB_CORE_DB", reservedDb("core")),
  // Leading platform constant for every physical DB name (see db-names.ts):
  // digita_<guid>_<app>_<target>. Entity targets ("app", "master", "sales", …)
  // become the <target> segment (with `-` normalised to `_`); reserved targets
  // (identity / logs / audits / core) keep their dedicated env vars.
  MONGODB_APP_DB_PREFIX: appDbPrefix,
  MONGODB_MIN_POOL: getEnvInt("MONGODB_MIN_POOL", 5),
  MONGODB_MAX_POOL: getEnvInt("MONGODB_MAX_POOL", 50),
  MONGODB_TIMEOUT_MS: getEnvInt("MONGODB_TIMEOUT_MS", 30000),
  MONGODB_RETRY_WRITES: getEnvBool("MONGODB_RETRY_WRITES", true),

  // ─── AUTH: token verification via digita-auth JWKS ────
  // The engine VERIFIES access tokens minted by digita-auth (offline, via
  // cached JWKS). It no longer issues tokens — login/refresh/2fa/sessions
  // live in digita-auth.
  AUTH_JWKS_URL: getEnv("AUTH_JWKS_URL", "http://localhost:3100/.well-known/jwks.json"),
  AUTH_ISSUER: getEnv("AUTH_ISSUER", "https://auth.digita.local"),
  AUTH_AUDIENCE: getEnv("AUTH_AUDIENCE", "digita"),
  // digita-auth BASE url — the engine MINTS on-behalf delegation tokens here for
  // hooks that call a satellite service (e.g. the ERP ZUGFeRD hook → digita-report).
  // No silent fallback: empty ⇒ `HookServices.mintDelegation` throws loudly AT USE
  // (not a boot crash — minting is a per-hook feature, not core), and the chart
  // sets AUTH_URL explicitly per stage. Short TTL — the token is used immediately.
  AUTH_URL: getEnv("AUTH_URL", ""),
  DELEGATION_TTL_SEC: getEnvInt("ENGINE_DELEGATION_TTL_SEC", 300),
  // Trusted-service keys (comma-separated → seamless rotation). A request
  // carrying a listed X-Engine-Api-Key plus X-On-Behalf-Of/-Roles headers runs
  // with THAT user's identity (via_service) — used by satellites like
  // digita-jobs. Empty list (default) disables the path entirely.
  ENGINE_API_KEYS: getEnvArray("ENGINE_API_KEYS", []),

  // ─── LOGGING ──────────────────────────────────────────
  LOG_LEVEL: getEnv("LOG_LEVEL", "debug") as "debug" | "info" | "warn" | "error" | "fatal",
  LOG_PRETTY: getEnvBool("LOG_PRETTY", true),
  LOG_TO_FILE: getEnvBool("LOG_TO_FILE", false),
  LOG_FILE_PATH: getEnv("LOG_FILE_PATH", "./logs"),
  LOG_FILE_MAX_SIZE: getEnv("LOG_FILE_MAX_SIZE", "50M"),
  LOG_FILE_MAX_FILES: getEnvInt("LOG_FILE_MAX_FILES", 10),
  LOG_FILE_ROTATE: getEnv("LOG_FILE_ROTATE", "daily"),
  LOG_TO_MONGO: getEnvBool("LOG_TO_MONGO", false),
  LOG_MONGO_TTL_DAYS: getEnvInt("LOG_MONGO_TTL_DAYS", 30),
  LOG_REDACT_FIELDS: getEnvArray("LOG_REDACT_FIELDS", [
    "password",
    "secret",
    "token",
    "authorization",
  ]),
  LOG_SEQ_ENABLED: getEnvBool("LOG_SEQ_ENABLED", false),
  LOG_SEQ_URL: getEnv("LOG_SEQ_URL", "http://localhost:5341"),
  LOG_SEQ_API_KEY: getEnv("LOG_SEQ_API_KEY", ""),

  // ─── LOCALE / i18n ───────────────────────────────────
  BOOTSTRAP_LOCALE: getEnv("BOOTSTRAP_LOCALE", "en"),

  // ─── TRANSLATION ─────────────────────────────────────
  TRANSLATION_SOURCE: getEnv("TRANSLATION_SOURCE", "both") as "file" | "mongodb" | "both",
  TRANSLATION_CACHE: getEnv("TRANSLATION_CACHE", "memory") as "redis" | "memory" | "none",
  TRANSLATION_CACHE_TTL_SEC: getEnvInt("TRANSLATION_CACHE_TTL_SEC", 3600),
  TRANSLATION_SEED_ON_BOOT: getEnvBool("TRANSLATION_SEED_ON_BOOT", true),
  TRANSLATION_FALLBACK_LOCALE: getEnv("TRANSLATION_FALLBACK_LOCALE", "en"),

  // ─── API ──────────────────────────────────────────────
  API_PREFIX: getEnv("API_PREFIX", "/api/v1"),
  API_RATE_LIMIT_MAX: getEnvInt("API_RATE_LIMIT_MAX", 1000),
  API_RATE_LIMIT_WINDOW: getEnv("API_RATE_LIMIT_WINDOW", "1m"),
  API_MAX_BODY_SIZE: getEnv("API_MAX_BODY_SIZE", "10mb"),
  API_TIMEOUT_MS: getEnvInt("API_TIMEOUT_MS", 60000),
  CORS_ORIGINS: getEnvArray("CORS_ORIGINS", ["http://localhost:5173"]),
  CORS_CREDENTIALS: getEnvBool("CORS_CREDENTIALS", true),

  // ─── FILE UPLOADS ────────────────────────────────────
  UPLOAD_MAX_SIZE: getEnv("UPLOAD_MAX_SIZE", "25mb"),
  UPLOAD_STORAGE: getEnv("UPLOAD_STORAGE", "local") as "local" | "s3",
  UPLOAD_LOCAL_PATH: getEnv("UPLOAD_LOCAL_PATH", "./uploads"),
  UPLOAD_S3_BUCKET: getEnv("UPLOAD_S3_BUCKET", ""),
  UPLOAD_S3_REGION: getEnv("UPLOAD_S3_REGION", ""),
  UPLOAD_S3_ENDPOINT: getEnv("UPLOAD_S3_ENDPOINT", ""),
  UPLOAD_S3_KEY: getEnv("UPLOAD_S3_KEY", ""),
  UPLOAD_S3_SECRET: getEnv("UPLOAD_S3_SECRET", ""),
  // NOTE: deliberately NOT "text/*" — text/html is browser-executable (stored
  // XSS via the download route). Active-content types (text/html, image/svg+xml,
  // XML flavors) are additionally hard-blocked in the upload router regardless
  // of this list.
  UPLOAD_ALLOWED_TYPES: getEnvArray("UPLOAD_ALLOWED_TYPES", [
    "image/*",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.*",
  ]),

  // ─── PERMISSION SCOPE ────────────────────────────────
  // Gate for declarative permission `scope` enforcement (a generic field-equality
  // narrowing — e.g. an app scoping records by company / department / tenant). OFF
  // by default: enabling it before the principal carries the matching claim
  // (scope.user_field) would lock non-admins out of every scoped entity (no value →
  // no rows). Flip to true once the auth token carries the claim AND every user has
  // a value. (`if_owner` scoping is unaffected — it is always enforced.)
  PERMISSION_SCOPE_ENABLED: getEnvBool("PERMISSION_SCOPE_ENABLED", false),

  // ─── BACKGROUND JOBS ─────────────────────────────────
  // NOTE (go-live audit): there is NO background-job runtime today. Every hook
  // runs SYNCHRONOUSLY inside the request transaction (see hook-runner.ts); hooks
  // that spawn side-effect docs (e.g. an on_submit posting a ledger entry) do so inline via
  // documentService.insert() on the same ClientSession. These JOBS_* settings are
  // reserved for a future queue (e.g. large exports / scheduled reports) and are
  // currently inert — nothing reads them at runtime.
  JOBS_ENABLED: getEnvBool("JOBS_ENABLED", true),
  JOBS_CONCURRENCY: getEnvInt("JOBS_CONCURRENCY", 5),
  JOBS_RETRY_ATTEMPTS: getEnvInt("JOBS_RETRY_ATTEMPTS", 3),
  JOBS_RETRY_DELAY_MS: getEnvInt("JOBS_RETRY_DELAY_MS", 5000),

  // ─── REALTIME / WEBSOCKET ────────────────────────────
  REALTIME_ENABLED: getEnvBool("REALTIME_ENABLED", true),
  WS_PATH: getEnv("WS_PATH", "/ws"),
  WS_PING_INTERVAL_MS: getEnvInt("WS_PING_INTERVAL_MS", 25000),

  // ─── IMPORT/EXPORT ───────────────────────────────────
  IMPORT_MAX_ROWS: getEnvInt("IMPORT_MAX_ROWS", 10000),
  EXPORT_MAX_ROWS: getEnvInt("EXPORT_MAX_ROWS", 50000),

  // ─── ENTITY ENGINE ───────────────────────────────────
  // APP_DIRS = explicit dirs (e.g. ./src for the platform-internal app) PLUS
  // every app folder auto-discovered under the APPS_DIRS root(s). So a new app
  // = a new folder in the apps root, with zero config change here or anywhere
  // downstream (everything below already iterates this list). See discoverAppDirs.
  // `.concat` (not a spread array literal) keeps the type a mutable `string[]`
  // under the object's `as const` — consumers in app.ts expect `string[]`.
  APP_DIRS: getEnvArray("APP_DIRS", []).concat(
    discoverAppDirs(getEnvArray("APPS_DIRS", [])),
  ),
  ENTITIES_DIR: getEnv("ENTITIES_DIR", `${platformAssetRoot}/entities`),
  MODULES_DIR: getEnv("MODULES_DIR", `${platformAssetRoot}/modules`),
  LOCALES_DIR: getEnv("LOCALES_DIR", `${platformAssetRoot}/locales`),
  AUTO_MIGRATE: getEnvBool("AUTO_MIGRATE", true),
  // Drop indexes that exist in MongoDB but are not declared in the
  // current entity definitions on every boot. Off by default —
  // destructive and irreversible. Turn on after a schema refactor that
  // removes indexes (e.g. the table_id removal left `idx_table_id`
  // orphan on existing collections).
  PRUNE_ORPHAN_INDEXES: getEnvBool("PRUNE_ORPHAN_INDEXES", false),
  // Drop collections in registered application databases that are not
  // declared by any current entity. Off by default — irreversible.
  // The schema migrator always logs orphan collections at boot regardless
  // of this flag (visibility); the flag only controls whether they get
  // dropped. The intended cleanup path after an entity rename — the
  // platform itself doesn't do cross-version migration, by design.
  PRUNE_ORPHAN_COLLECTIONS: getEnvBool("PRUNE_ORPHAN_COLLECTIONS", false),
  // Delete VIEW rows whose backing `<appDir>/views/**.view.json` file was
  // removed or renamed. Off by default — a momentarily misconfigured or
  // partially mounted APPS_DIRS at boot could otherwise misclassify a real
  // app's views as orphans and delete them irreversibly. The view loader
  // always logs detected orphan view ids at boot regardless of this flag
  // (visibility); the flag only controls whether they get deleted.
  PRUNE_ORPHAN_VIEWS: getEnvBool("PRUNE_ORPHAN_VIEWS", false),
  TRACK_CHANGES_DEFAULT: getEnvBool("TRACK_CHANGES_DEFAULT", true),

  // Dev convenience (opt-in): seed app data at boot, auto/non-destructive (skip
  // rows whose _id already exists). Two INDEPENDENT tiers, both OFF by default —
  // production seeds ONLY via POST /api/v1/admin/reseed (destructive reset path).
  //   SEED_APP_DATA_ON_BOOT  → reference tier (<appDir>/<domain>/seeds/)
  //   SEED_DEMO_DATA_ON_BOOT → demo tier      (<appDir>/<domain>/seeds-demo/)
  SEED_APP_DATA_ON_BOOT: getEnvBool("SEED_APP_DATA_ON_BOOT", false),
  SEED_DEMO_DATA_ON_BOOT: getEnvBool("SEED_DEMO_DATA_ON_BOOT", false),

  // Declarative views — `<appDir>/views/**.view.json`.
  // Empty (default): preserve admin-overridden DB rows (overridden=true).
  // Comma-list (e.g. "customer360"): force-reseed those views.
  // "*": force-reseed every view.
  VIEW_FORCE: getEnvArray("VIEW_FORCE", []),
} as const;

export type Env = typeof env;
