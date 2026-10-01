import type { BlockType } from "@/lib/types";
import type { BlockComponent, BlockManifest } from "@/catalog/types";
import { Hero, RichText, FeatureGrid, Media, Cta, Stats, Embed, Code } from "./components";
import { HeroBrand } from "./marketing/HeroBrand";
import { Pillars } from "./marketing/Pillars";
import { Stack } from "./marketing/Stack";
import { Pipeline } from "./marketing/Pipeline";
import { Compare } from "./marketing/Compare";
import { Checklist } from "./marketing/Checklist";
import { Segments } from "./marketing/Segments";
import { Signals } from "./marketing/Signals";
import { CtaPanel } from "./marketing/CtaPanel";
import { ContactDetails } from "./marketing/ContactDetails";
import { Showcase } from "./marketing/Showcase";
import { RecordForm } from "./RecordForm";
import { AppList } from "./AppList";

/**
 * Block manifests — the single source for which generic block types the renderer
 * knows. What a block's props hold, its component reads and says.
 * `plugin` is handled separately by BlockRenderer (dynamic import), so it isn't
 * here. Add a block type by adding a component + a manifest entry.
 */
export const BLOCK_MANIFESTS: BlockManifest[] = [
  {
    type: "hero",
    name: "Hero",
    description: "Large headline, subheading and a call-to-action.",
    category: "content",
    component: Hero,
  },
  {
    type: "richtext",
    name: "Rich text",
    description: "A heading and paragraphs of body copy.",
    category: "content",
    component: RichText,
  },
  {
    type: "feature_grid",
    name: "Feature grid",
    description: "A grid of titled feature cards.",
    category: "content",
    component: FeatureGrid,
  },
  {
    type: "stats",
    name: "Stats",
    description: "A proof strip: up to four facts, each a value over its label, divided by hairlines.",
    category: "content",
    component: Stats,
  },
  {
    type: "media",
    name: "Media",
    description: "A responsive image with an optional caption.",
    category: "media",
    component: Media,
  },
  {
    type: "cta",
    name: "Call to action",
    description: "A glowing panel with a headline, a body and a button.",
    category: "content",
    component: Cta,
  },
  {
    type: "embed",
    name: "Embed",
    description: "An embedded iframe (video, map, …).",
    category: "media",
    component: Embed,
  },
  {
    type: "code",
    name: "Code",
    description: "A titled, scrollable code/definition snippet.",
    category: "content",
    component: Code,
  },
  {
    type: "hero_brand",
    name: "Brand hero",
    description: "The opening section of a site: headline, lede, calls to action and the figure a plugin draws.",
    category: "content",
    component: HeroBrand,
  },
  {
    type: "pillars",
    name: "Pillars",
    description: "Three or four numbered steps or ideas, one card each.",
    category: "content",
    component: Pillars,
  },
  {
    type: "stack",
    name: "Product stack",
    description: "Products or apps, each with its lockup or title, its status and a link.",
    category: "content",
    component: Stack,
  },
  {
    type: "pipeline",
    name: "Pipeline",
    description: "The stages of a process in order, one column each.",
    category: "content",
    component: Pipeline,
  },
  {
    type: "compare",
    name: "Comparison",
    description: "Two approaches compared row by row; the second column is the one the page argues for.",
    category: "content",
    component: Compare,
  },
  {
    type: "checklist",
    name: "Checklist",
    description: "What is included, as a checked list in two or three columns.",
    category: "content",
    component: Checklist,
  },
  {
    type: "segments",
    name: "Segments",
    description: "Who a product is for: each audience, who they are and what they gain.",
    category: "content",
    component: Segments,
  },
  {
    type: "signals",
    name: "Signals",
    description: "A row of chips a visitor recognizes themselves in, with a note line.",
    category: "content",
    component: Signals,
  },
  {
    type: "cta_panel",
    name: "Call to action panel",
    description: "A glowing panel with a headline, a body and up to two actions.",
    category: "content",
    component: CtaPanel,
  },
  {
    type: "contact_details",
    name: "Contact details",
    description: "The address, email and phone, with a booking button once a booking link exists.",
    category: "content",
    component: ContactDetails,
  },
  {
    type: "showcase",
    name: "Showcase",
    description: "A live plugin under a section heading, with a caption.",
    category: "interactive",
    component: Showcase,
  },
  {
    type: "record_form",
    name: "Record form",
    description: "A form that creates one record of an entity through the Guest create of its engine, then thanks the visitor.",
    category: "interactive",
    component: RecordForm,
  },
  {
    type: "app_list",
    name: "App list",
    description: "One card per app of the tenant, each entering its app; on a demo tenant also signed in as the demo user.",
    category: "content",
    component: AppList,
  },
];

const BY_TYPE = new Map<BlockType, BlockComponent>(BLOCK_MANIFESTS.map((m) => [m.type, m.component]));

/** Component for a block type, or undefined if unknown (renderer skips it). */
export function getBlockComponent(type: BlockType): BlockComponent | undefined {
  return BY_TYPE.get(type);
}
