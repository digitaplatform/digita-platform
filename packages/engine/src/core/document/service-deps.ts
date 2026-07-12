import type { EntityRegistry } from "../entity/entity-registry.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { HookRunner } from "../hooks/hook-runner.js";
import type { LinkValidator } from "../link/link-validator.js";
import type { LinkTitleResolver } from "../link/link-title-resolver.js";
import type { FetchFromResolver } from "../fetch/fetch-from-resolver.js";
import type { SnapshotResolver } from "../snapshot/snapshot-resolver.js";
import type { ZodSchemaBuilder } from "../entity/zod-schema-builder.js";
import type { WorkflowEngine } from "../workflow/workflow-engine.js";
import type { PeriodCloseValidator } from "../period/period-close-validator.js";
import type { DeleteProtection } from "../link/delete-protection.js";
import type { CancelProtection } from "../link/cancel-protection.js";
import type { VersionService } from "../version/version-service.js";
import type { ViewLogService } from "../version/view-log-service.js";
import type { TranslationService } from "../i18n/translation-service.js";
import type { ActivityLogService } from "../logging/activity-log-service.js";
import type { DocumentShareService } from "../permissions/document-share-service.js";
import type { RuleEngine } from "../rules/rule-engine.js";
import type { StoragePort } from "../storage/storage-port.js";

/**
 * All dependencies required by DocumentService.
 * Passed as a single object to avoid 13+ constructor params.
 */
export interface DocumentServiceDeps {
  registry: EntityRegistry;
  db: MongoDBService;
  permissionChecker: PermissionChecker;
  hookRunner: HookRunner;
  linkValidator: LinkValidator;
  linkTitleResolver: LinkTitleResolver;
  fetchFromResolver: FetchFromResolver;
  /** Optional for backwards compatibility with older test fixtures.
   *  Production wiring (`app.ts`) always provides one. */
  snapshotResolver?: SnapshotResolver;
  /** Optional. When omitted DocumentService instantiates its own — the
   *  builder is just a per-entity Zod schema cache. Provide explicitly to
   *  share the cache across services or to inject test schemas. */
  zodSchemaBuilder?: ZodSchemaBuilder;
  /** Optional. When provided, document-service stamps initial workflow
   *  state on insert and validates transitions on update. */
  workflowEngine?: WorkflowEngine;
  /** Optional. When provided, document-service enforces `period_check` on
   *  the configured lifecycle phases (default `submit` only). */
  periodCloseValidator?: PeriodCloseValidator;
  deleteProtection: DeleteProtection;
  /** Forward immutability — required so cancel can detect submitted
   *  downstream documents and reject the operation. */
  cancelProtection: CancelProtection;
  versionService: VersionService;
  viewLogService: ViewLogService;
  translationService: TranslationService;
  activityLogService: ActivityLogService;
  ruleEngine?: RuleEngine;
  /** Optional. When omitted DocumentService builds its own (needs only `db`).
   *  An explicit DocShare grants read/write on a single doc even when RBAC
   *  would deny it. */
  documentShareService?: DocumentShareService;
  /** Optional. When provided, DocumentService deletes orphaned File docs + blobs
   *  on document delete and on attach-field clear/replace (reference-counted).
   *  Omitted in test fixtures that don't exercise attachments. */
  storage?: StoragePort;
}
