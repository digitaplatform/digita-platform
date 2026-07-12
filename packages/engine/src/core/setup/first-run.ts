import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { TranslationService } from "../i18n/translation-service.js";
import { SchemaMigrator } from "../database/schema-migrator.js";
import { seedLanguages } from "./seed-languages.js";
import { seedRoles } from "./seed-roles.js";
import { seedSystemSettings } from "./seed-system-settings.js";
import { seedBrandingSettings } from "./seed-branding-settings.js";
import { seedEntityDefinitions } from "./seed-entity-definitions.js";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("first-run");

/**
 * Run first-time setup: seed data, migrate schemas, create admin user.
 */
export async function firstRun(
  db: MongoDBService,
  registry: EntityRegistry,
  translationService: TranslationService,
): Promise<void> {
  const startTime = Date.now();
  log.info("Starting first-run setup");

  // 1. Ensure system collections
  await db.ensureCollection("_sequences", DIGITA.DATABASES.CORE);
  await db.ensureCollection("_doc_guards", DIGITA.DATABASES.CORE);
  await db.ensureCollection("_versions", DIGITA.DATABASES.AUDITS);
  await db.ensureCollection("_view_logs", DIGITA.DATABASES.LOGS);

  // 2. Seed core data
  await seedLanguages(db);
  await seedRoles(db);
  await seedSystemSettings(db);
  await seedBrandingSettings(db);
  await seedEntityDefinitions(db, registry);

  // 3. Migrate all entity schemas (create collections + indexes)
  if (env.AUTO_MIGRATE) {
    const migrator = new SchemaMigrator(db);
    await migrator.migrateAll(registry.getAll());
  }

  // 4. Translation seeding is now handled in app.ts startup (supports multiple app dirs)

  // Identity (admin seed, users, passwords, 2FA, sessions) is owned by
  // digita-auth — it seeds the default admin on boot. The engine no longer
  // creates or authenticates users; it only verifies digita-auth's tokens.

  log.info({ duration_ms: Date.now() - startTime }, "First-run setup completed");
}
