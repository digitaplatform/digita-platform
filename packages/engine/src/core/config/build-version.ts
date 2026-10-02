import { readFileSync } from "node:fs";

/**
 * The version of the running build: a release stamps it into the engine's manifest, which the image
 * carries beside dist/, so it is read from there and from no setting. A build without its manifest
 * fails at start.
 */
export const BUILD_VERSION = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
