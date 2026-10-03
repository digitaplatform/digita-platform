import { readFileSync } from "node:fs";

/**
 * The version of the running build: a release stamps it into the engine's manifest, which the image
 * carries beside dist/, so it is read from there and from no setting. A build without its manifest
 * fails at start.
 */
export const BUILD_VERSION = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** No build argument means no image version; the footer omits this component. */
export function getBuildInfo(): { name: string; version?: string; subpackages?: { name: string; version: string }[] } {
  if (!process.env["BUILD_VERSION"]) return { name: "digita-platform" };
  const info = JSON.parse(readFileSync(new URL("../../../build-info.json", import.meta.url), "utf8")) as { name: string; version?: string; subpackages: { name: string; version: string }[] };
  return { name: info.name, ...(info.version === process.env["BUILD_VERSION"] ? { version: info.version } : {}), subpackages: info.subpackages.map(({ name, version }) => ({ name, version })) };
}
