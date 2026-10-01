import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const holdsEntities = (dir: string): boolean =>
  existsSync(dir) && readdirSync(dir, { recursive: true }).some((f) => String(f).endsWith(".entity.json"));

/**
 * The folder of one app in a catalog checkout. A catalog keeps each app in `apps/<app>/` and each
 * website in `webs/<site>/`; a checkout made before that layout keeps the app at its root. The
 * folder that holds the app's entity files wins, because a switch between the two layouts leaves
 * the untracked build output (`.js`) of the other one behind.
 */
export function catalogAppDir(catalog: string, app: string): string {
  const moved = join(catalog, "apps", app);
  return holdsEntities(moved) ? moved : join(catalog, app);
}
