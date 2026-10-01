import type { Block, WebSite } from "@/lib/types";
import type { Locale } from "@/i18n/config";
import type { BlockComponent } from "@/catalog/types";
import { getBlockComponent } from "./registry";
import { PluginBlock } from "./PluginBlock";

/**
 * Renders an ordered list of content blocks. Each block resolves its component
 * from the registry (or the plugin seam for `type: "plugin"`). Unknown types are
 * skipped so a new engine-side type never crashes a deployed renderer. `anchor`
 * becomes a scroll target; `theme_variant: "dark"` becomes `data-variant="dark"`, which the theme
 * draws as a dark band (DARK_BAND_SELECTOR in @digitaplatform/theme).
 */
export function BlockRenderer({ blocks, locale, site }: { blocks?: Block[]; locale: Locale; site?: WebSite | null }) {
  if (!blocks?.length) return null;
  return (
    <>
      {blocks.map((block, i) => {
        const Component: BlockComponent | undefined = block.type === "plugin" ? PluginBlock : getBlockComponent(block.type);
        if (!Component) return null;
        return (
          <div
            key={block._row_id ?? `${block.type}-${i}`}
            id={block.anchor || undefined}
            data-block={block.type}
            data-variant={block.theme_variant || undefined}
            className={block.anchor ? "scroll-mt-24" : undefined}
          >
            <Component props={block.props} locale={locale} site={site} />
          </div>
        );
      })}
    </>
  );
}
