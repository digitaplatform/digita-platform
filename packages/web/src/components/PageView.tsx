import type { WebPage, WebSite } from "@/lib/types";
import { BlockRenderer } from "@/blocks/BlockRenderer";
import { pageJsonLd } from "@/lib/seo";

/** Renders a resolved WebPage: its blocks + page-level JSON-LD. */
export function PageView({ page, site }: { page: WebPage; site: WebSite | null }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: pageJsonLd(page, site) }} />
      <BlockRenderer blocks={page.blocks} />
    </>
  );
}
