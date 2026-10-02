import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  DIGITA,
  canEnterAudience,
  type Audience,
  type AudienceGrant,
  type AudienceMap,
} from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { DocumentService } from "../document/document-service.js";
import type { LocaleResolver } from "../i18n/locale-resolver.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { env } from "../config/env.js";
import { successResponse } from "./response-model.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("boot-router");

/** Tolerant role-list parse for a JSON field (native array OR stringified). */
function parseRoleList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      log.warn({ value }, "malformed is_default_for_roles JSON — skipping workspace");
      return [];
    }
  }
  return [];
}

/**
 * Resolve the user's default Workspace id: the highest-priority (lower wins),
 * enabled workspace whose `is_default_for_roles` intersects the user's roles.
 * `null` is legitimate (no role-default → the client picks a fallback). Never
 * throws — a bad row is skipped + logged; /boot must not 500.
 */
async function resolveDefaultWorkspace(
  db: MongoDBService,
  user: { roles?: string[] } | null | undefined,
): Promise<string | null> {
  if (!user) return null;
  const userRoles = new Set(user.roles ?? []);
  try {
    const rows = (await db.find(
      DIGITA.COLLECTIONS.WORKSPACE,
      {
        filters: [{ enabled: true }],
        order_by: "priority asc",
        limit: 50,
        fields: ["_id", "is_default_for_roles", "priority"],
      },
      DIGITA.DATABASES.CORE,
    )) as Record<string, unknown>[];
    for (const row of rows) {
      const dfr = parseRoleList(row["is_default_for_roles"]);
      if (dfr.some((r) => userRoles.has(r))) return String(row["_id"]);
    }
  } catch (err) {
    log.warn({ err }, "default_workspace resolution failed — returning null");
  }
  return null;
}

/**
 * Whether the engine's apps are set up, as `user` may know it. Every signed-in caller learns
 * whether the setup is complete. A pending settings record and its open fields go only to a
 * caller who may write that record and every open field of it, so nobody reads here a schema
 * their audience does not get, and nobody is sent to a form whose save refuses a field they
 * cannot fill; such a caller is told to ask.
 */
async function resolveSetup(
  user: UserContext,
  documentService: DocumentService,
  permissionChecker: PermissionChecker,
): Promise<{ complete: boolean; records: Array<{ entity: string; fields: string[]; missing_record: boolean }> }> {
  const pending = await documentService.listPendingSetupRecords();
  const records = [];
  for (const { entity, row, fields } of pending) {
    if (!(await permissionChecker.hasPermission(user, entity.name, "write", row)).allowed) continue;
    const writable = permissionChecker.getWritableFields(user, entity.name, row);
    if (writable && !fields.every((field) => writable.has(field))) continue;
    records.push({ entity: entity.name, fields, missing_record: row === undefined });
  }
  return { complete: pending.length === 0, records };
}

/**
 * Register the boot endpoint — called once when frontend loads. Returns identity,
 * locale, languages, system settings, and the resolved branding (from the
 * BrandingSetting singleton). The engine knows nothing about UI navigation — a
 * nav plugin reads its own entity via the generic resource API.
 */
export function registerBootRoutes(
  app: FastifyInstance,
  prefix: string,
  db: MongoDBService,
  localeResolver: LocaleResolver,
  documentService: DocumentService,
  permissionChecker: PermissionChecker,
  /** Lazy getter for the per-app audience map (ADR-A3); relayed verbatim so the
   *  shell can compose per tier and the anonymous branch can find a public entry.
   *  A getter (not a value) because plugin config loads AFTER routes register. */
  getAudiences: () => AudienceMap = () => ({}),
): void {
  app.get(`${prefix}/boot`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;

    // Audience-set (ADR-A1): the authenticated tiers this caller may enter, read
    // from the verified token's `tiers` claim (never derived from a role, ADR-A2;
    // absent/anonymous ⇒ [] grants). canEnterAudience is the ONE shared entry gate
    // — computed server-side per tier so the shell doesn't re-implement the rule.
    // NOTE: this is presentation-scoping only; RBAC remains the data boundary.
    const grants: AudienceGrant[] = Array.isArray(user?.tiers) ? user.tiers : [];
    const appAudiences = getAudiences();
    const canEnter = Object.fromEntries(
      (["anonymous", "external", "internal"] as Audience[]).map((t) => [t, canEnterAudience(t, grants)]),
    );
    const locale = await localeResolver.resolve(user ?? undefined, request.headers["accept-language"] as string);

    // Get available languages
    const languages = await db.find(
      DIGITA.COLLECTIONS.LANGUAGE,
      {
        filters: [{ enabled: true }],
        fields: ["_id", "native_name", "flag_emoji", "direction"],
        order_by: "name asc",
      },
      DIGITA.DATABASES.CORE,
    );

    // Get system settings
    const settings = await db.findOne(DIGITA.COLLECTIONS.SETTING, "settings", DIGITA.DATABASES.CORE);
    const settingsData = (settings ?? {}) as Record<string, unknown>;

    // Branding singleton (is_single — at most one row; read without assuming its
    // _id). Absent → the frontend uses its defaults / fallback theme.
    const brandingRows = await db.find(
      DIGITA.COLLECTIONS.BRANDING_SETTING,
      { limit: 1 },
      DIGITA.DATABASES.CORE,
    );
    const b = (brandingRows[0] ?? {}) as Record<string, unknown>;

    const default_workspace = await resolveDefaultWorkspace(db, user);

    return reply.send(
      successResponse({
        user: user
          ? {
              _id: user._id,
              email: user.email,
              full_name: user.full_name,
              language: user.language,
              roles: user.roles,
              // Audience-set carried on identity (mirrors the token claim).
              tiers: user.tiers,
              // A demo session keeps its own locale on its IdP session, not on the shared user.
              ...(user["demo"] === true ? { demo: true } : {}),
            }
          : null,
        // Audience (ADR-A1…A3): the caller's grant-set, the app's per-tier
        // declaration, and the server-computed entry verdict per tier. The
        // anonymous branch (user=null) still gets `app` so it can find a public entry.
        audience: {
          grants,
          app: appAudiences,
          can_enter: canEnter,
        },
        locale,
        available_languages: (languages as Record<string, unknown>[]).map((l) => ({
          code: l["_id"],
          native_name: l["native_name"],
          flag_emoji: l["flag_emoji"],
          // A switch lays the page out by it without reading the Language row, which
          // only some roles may read. A row without one is left to right, as the
          // LocaleResolver reads it.
          direction: l["direction"] ?? "ltr",
        })),
        system_settings: {
          platform_name: settingsData["platform_name"] ?? "Digita Platform",
          // No silent currency fallback (F3): the field is required + boot-linted +
          // seeded, so this is always set; null only on a corrupted singleton, which
          // the frontend renders as an em-dash and warns about (never a wrong symbol).
          default_currency: settingsData["default_currency"] ?? null,
          allow_user_language: settingsData["allow_user_language"] ?? true,
          // The tenant's day, which the form's __today__ names, as the engine's default does.
          timezone: (settingsData["timezone"] as string) || "UTC",
        },
        // An anonymous caller gets no setup state: it could fill nothing.
        setup: user ? await resolveSetup(user, documentService, permissionChecker) : null,
        // Resolved branding (BrandingSetting singleton); undefined fields are
        // omitted → the frontend applies its defaults. app_name falls back to the
        // platform name. The design-system runtime (applyBranding) consumes these.
        branding: {
          app_name: b["app_name"] ?? settingsData["platform_name"] ?? "Digita Platform",
          logo: b["logo"] ?? undefined,
          logo_dark: b["logo_dark"] ?? undefined,
          favicon: b["favicon"] ?? undefined,
          primary_color: b["primary_color"] ?? undefined,
          accent_palette: b["accent_palette"] ?? undefined,
          density: b["density"] ?? undefined,
          default_template: b["default_template"] ?? undefined,
          default_signature: b["default_signature"] ?? undefined,
          web_default_signature: b["web_default_signature"] ?? undefined,
          allow_user_theme_mode: b["allow_user_theme_mode"] ?? undefined,
          login_background: b["login_background"] ?? undefined,
        },
        // Resolved Workspace id (highest-priority role-default), or null → client picks a fallback.
        default_workspace,
        // Live-sync transport: the client only opens a WebSocket when the engine
        // has it enabled (else it would reconnect-storm against a missing route).
        // The path mirrors the gateway in app.ts (env.WS_PATH).
        realtime: { enabled: env.REALTIME_ENABLED, path: env.WS_PATH },
      }),
    );
  });
}
