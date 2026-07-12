import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("role-registry");

/**
 * In-memory authoritative set of role code identifiers.
 *
 * Loaded at boot from the Role collection. Used for fast validation of:
 * entity permission definitions (at entity load time)
 * user.roles assignments (at save time)
 * any other place that needs to confirm "does this role exist?"
 *
 * Runtime permission checks stay as string comparisons in PermissionChecker;
 * this registry only validates writes and catches typos early.
 */
export class RoleRegistry {
  private names = new Set<string>();

  constructor(private db: MongoDBService) {}

  /** Populate the registry from the Role collection. Safe to call repeatedly. */
  async load(): Promise<void> {
    this.names.clear();
    // Role lives in the "identity" database (see role.entity.json)
    const docs = (await this.db.find(DIGITA.COLLECTIONS.ROLE, { filters: [] }, DIGITA.DATABASES.IDENTITY)) as Record<
      string,
      unknown
    >[];
    for (const doc of docs) {
      const code = (doc["name"] as string | undefined) ?? (doc["_id"] as string);
      if (code) this.names.add(code);
    }
    log.info({ count: this.names.size, roles: Array.from(this.names) }, "RoleRegistry loaded");
  }

  /** True if the given role code exists. */
  has(name: string): boolean {
    return this.names.has(name);
  }

  /** All known role codes. */
  list(): string[] {
    return Array.from(this.names).sort();
  }

  /**
   * Throw if the role doesn't exist. `context` is included in the error
   * to make misconfigurations easy to locate (e.g. which entity referenced it).
   */
  assertExists(name: string, context: string): void {
    if (!this.has(name)) {
      throw new Error(
        `Unknown role "${name}" referenced by ${context}. Known roles: ${this.list().join(", ")}`,
      );
    }
  }

  /** Register a newly created role without a full reload. */
  register(name: string): void {
    if (name) this.names.add(name);
  }

  /** Remove a role from the registry (e.g. after deletion). */
  unregister(name: string): void {
    this.names.delete(name);
  }
}

// Module-level singleton — set once at startup so hooks can reach the registry
// without needing dependency injection through the hook runner signature.
let _instance: RoleRegistry | null = null;

export function setRoleRegistry(instance: RoleRegistry): void {
  _instance = instance;
}

export function getRoleRegistry(): RoleRegistry {
  if (!_instance) {
    throw new Error("RoleRegistry not initialized. App must call setRoleRegistry() at startup.");
  }
  return _instance;
}
