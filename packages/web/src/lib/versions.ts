import "server-only";
import { parseBuildInfo, type BuildInfo } from "@digitaplatform/components";
import { getConfig } from "@/config/env";

/** Read the website's own engine; its internal address never reaches a client. */
export async function getEngineBuildInfo(): Promise<BuildInfo | null> {
  try {
    const response = await fetch(`${getConfig().engineUrl}/health`, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(4000) });
    return response.ok ? parseBuildInfo(await response.json()) : null;
  } catch {
    // No readable version means this component is absent from the footer.
    return null;
  }
}
