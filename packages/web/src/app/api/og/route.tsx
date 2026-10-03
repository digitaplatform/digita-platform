import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { semantic, type SemanticTokens } from "@digitaplatform/theme";
import { getConfig } from "@/config/env";
import { isLocale } from "@/config/locales";
import { findWebsiteSignature, getPage, getSite } from "@/lib/engine-client";
import { siteSignature } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * The link preview image of a published page: its title, as the link preview names it, and the
 * site's name in the colors of the site's signature, 1200 × 630 as link previews draw it. Only a
 * page the engine publishes has one, so the route draws no text a request names.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const config = getConfig();
  const locale = request.nextUrl.searchParams.get("locale") ?? "";
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  if (!isLocale(locale, config.locales)) return new Response(null, { status: 404 });
  const [page, site, websiteLook] = await Promise.all([getPage(locale, slug), getSite(), findWebsiteSignature()]);
  if (!page) return new Response(null, { status: 404 });

  const signature = siteSignature(site?.theme, websiteLook);
  // A token the signature leaves out takes the default design's light value, as a page does.
  const color = (token: keyof SemanticTokens) => signature.colors?.[token]?.light ?? semantic.light[token];
  const text = color("textMain");
  const accent = signature.accent || text;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: color("bg"),
          borderTop: `16px solid ${accent}`,
        }}
      >
        <div style={{ display: "flex", fontSize: 36, color: accent }}>{site?.site_name ?? signature.name}</div>
        <div style={{ display: "flex", fontSize: 72, lineHeight: 1.15, color: text }}>{page.meta_title || page.title}</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "cache-control": `public, max-age=${config.revalidateSeconds}` } },
  );
}
