import type { Block } from "@/lib/types";
import { getBlockComponent } from "./registry";
import { PluginBlock } from "./PluginBlock";

/**
 * Renders an ordered list of content blocks. Each block resolves its component
 * from the registry (or the plugin seam for `type: "plugin"`). Unknown types are
 * skipped so a new engine-side type never crashes a deployed renderer. `anchor`
 * becomes a scroll target; `theme_variant` is exposed as a data attribute for
 * per-section theme overrides.
 */
export function BlockRenderer({ blocks }: { blocks?: Block[] }) {
  if (!blocks?.length) return null;
  return (
    <>
      {blocks.map((block, i) => {
        const Component = block.type === "plugin" ? PluginBlock : getBlockComponent(block.type);
        if (!Component) return null;
        return (
          <div
            key={block._row_id ?? `${block.type}-${i}`}
            id={block.anchor || undefined}
            data-block={block.type}
            data-variant={block.theme_variant || undefined}
            className={block.anchor ? "scroll-mt-24" : undefined}
          >
            <Component props={block.props} />
          </div>
        );
      })}
    </>
  );
}
