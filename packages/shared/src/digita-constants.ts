/**
 * Digita backend — collection + database name constants.
 *
 * Hand-maintained alongside `packages/backend/src/entities/*.entity.json`.
 * When you add or rename an entity, update this file too. The TypeScript
 * compiler will surface any reference that doesn't match a constant key,
 * so drift between the JSON files and these constants is caught at build
 * time. Reference these constants instead of hardcoding bare strings:
 * future renames then become a single edit here plus whatever the
 * compiler flags.
 */

export const DIGITA = {
  COLLECTIONS: {
    // Identity (auth)
    USER: "User",
    ROLE: "Role",
    SESSION: "Session",
    PERMISSION: "Permission",
    DOC_SHARE: "DocShare",
    // i18n
    LANGUAGE: "Language",
    TRANSLATION: "Translation",
    // Configuration / storage
    SETTING: "Setting",
    BRANDING_SETTING: "BrandingSetting",
    FILE: "File",
    // Audit
    LOG: "Log",
    // Definition storage (consumed by engines)
    ENTITY: "Entity",
    RULE: "Rule",
    VIEW: "View",
    WORKSPACE: "Workspace",
    LIST_PREFERENCE: "ListPreference",
    USER_PREFERENCE: "UserPreference",
  },
  DATABASES: {
    CORE: "core",
    IDENTITY: "identity",
    LOGS: "logs",
    AUDITS: "audits",
  },
} as const;

export type DIGITACollection = (typeof DIGITA)["COLLECTIONS"][keyof (typeof DIGITA)["COLLECTIONS"]];
export type DIGITADatabase = (typeof DIGITA)["DATABASES"][keyof (typeof DIGITA)["DATABASES"]];
