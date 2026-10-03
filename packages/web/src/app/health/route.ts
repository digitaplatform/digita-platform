import { readFileSync } from "node:fs";

export const dynamic = "force-dynamic";
export function GET(): Response {
  const name = "digita-platform";
  const baked = process.env.BUILD_VERSION;
  const info = baked ? JSON.parse(readFileSync("/app/packages/web/build-info.json", "utf8")) as { version?: string; subpackages: { name: string; version: string }[] } : null;
  return Response.json({ name, ...(info?.version === baked && baked ? { version: baked } : {}), ...(info ? { subpackages: info.subpackages.map(({ name, version }) => ({ name, version })) } : {}) }, {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}
