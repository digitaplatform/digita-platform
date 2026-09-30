import { REVALIDATE_SECRET_HEADER, entityCacheTag, type EntityDefinition } from "@digitaplatform/shared";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import { createLogger } from "../logging/logger.js";
import { GUEST_USER } from "./public-router.js";

const log = createLogger("revalidate-notifier");

export interface RevalidateSettings {
  REVALIDATE_URL: string;
  REVALIDATE_SECRET: string;
}

const POST_TIMEOUT_MS = 5000;

/**
 * Tells the website renderer to drop its cached reads of an entity a visitor can read, so a
 * committed write shows on the next page load instead of after the renderer's TTL. The engine
 * posts the entity's cache tag with the shared secret to REVALIDATE_URL; an entity that does not
 * grant Guest read is never cached by the renderer and posts nothing.
 */
export class RevalidateNotifier {
  /** The settings are read on every call, so the engine's env module can be passed as is. */
  constructor(
    private readonly permissionChecker: PermissionChecker,
    private readonly settings: RevalidateSettings,
  ) {}

  /**
   * Fails start-up when an entity grants Guest read and a setting is missing, naming the
   * setting, so no engine serves a site whose saves it cannot show.
   */
  async assertSettings(entities: EntityDefinition[]): Promise<void> {
    const first = (await this.publicEntities(entities))[0];
    if (!first) return;
    for (const key of ["REVALIDATE_URL", "REVALIDATE_SECRET"] as const) {
      if (!this.settings[key]) {
        throw new Error(`Missing required environment variable: ${key} (${first} grants Guest read)`);
      }
    }
  }

  /** Posts the tag of `doctype` when it grants Guest read. Not awaited by the request: a failed
   *  or refused post is logged, and the renderer then serves its cache until the TTL. */
  notify(doctype: string): void {
    void this.isPublic(doctype).then(
      (isPublic) => (isPublic ? this.post([doctype]) : undefined),
      (err: unknown) => log.error({ entities: [doctype], err: (err as Error).message }, "Renderer cache purge failed"),
    );
  }

  /** Posts the tags of every entity that grants Guest read, once: after the boot site seed,
   *  which writes rows without a request. */
  async notifyAll(entities: EntityDefinition[]): Promise<void> {
    const doctypes = await this.publicEntities(entities);
    if (doctypes.length > 0) await this.post(doctypes);
  }

  private async isPublic(doctype: string): Promise<boolean> {
    return (await this.permissionChecker.hasPermission(GUEST_USER, doctype, "read")).allowed;
  }

  private async publicEntities(entities: EntityDefinition[]): Promise<string[]> {
    const doctypes: string[] = [];
    for (const entity of entities) if (await this.isPublic(entity.name)) doctypes.push(entity.name);
    return doctypes;
  }

  private async post(doctypes: string[]): Promise<void> {
    try {
      const res = await fetch(this.settings.REVALIDATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", [REVALIDATE_SECRET_HEADER]: this.settings.REVALIDATE_SECRET },
        body: JSON.stringify({ tags: doctypes.map(entityCacheTag) }),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
      if (!res.ok) log.error({ entities: doctypes, status: res.status }, "Renderer refused the cache purge");
    } catch (err) {
      log.error({ entities: doctypes, err: (err as Error).message }, "Renderer cache purge failed");
    }
  }
}
