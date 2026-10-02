import { RevalidateNotifier, type RevalidateSettings } from "./revalidate-notifier.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { assertPasswordFieldKeys } from "../entity/password-cipher.js";
import { PermissionChecker } from "../permissions/permission-checker.js";

/**
 * The checks the loaded definitions pass before the engine serves them, at boot and before a
 * reload replaces anything: an entity that stores a Password field needs the key set, an entity a
 * visitor can read needs the renderer's revalidate settings, and a Link names a loaded entity.
 * Each is judged on `registry`, so a reload's scratch registry is judged on what it would serve.
 */
export async function assertDefinitionsServable(registry: EntityRegistry, revalidateSettings: RevalidateSettings): Promise<void> {
  assertPasswordFieldKeys(registry.getAll());
  await new RevalidateNotifier(new PermissionChecker(registry), revalidateSettings).assertSettings(registry.getAll());
  registry.assertLinkTargetsLoaded();
}
