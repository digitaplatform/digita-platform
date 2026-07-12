import type { MetadataRoute } from "next";
import { getConfig } from "@/config/env";

// Dynamic: reads SITE_URL from runtime env (no build-time bake).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const { siteUrl } = getConfig();
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
