import type { BlockType } from "@/lib/types";
import type { BlockManifest, RenderComponent } from "@/catalog/types";
import { Hero, RichText, FeatureGrid, Media, Cta, Stats, Embed, Code } from "./components";

/**
 * Block manifests — the single source for which generic block types the renderer
 * knows, each self-describing its configurable props (for a visual builder).
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
    props: [
      { name: "heading", label: "Heading", type: "text", required: true },
      { name: "subheading", label: "Subheading", type: "textarea" },
      { name: "cta_label", label: "CTA label", type: "text" },
      { name: "cta_href", label: "CTA link", type: "url" },
    ],
  },
  {
    type: "richtext",
    name: "Rich text",
    description: "A heading and paragraphs of body copy.",
    category: "content",
    component: RichText,
    props: [
      { name: "heading", label: "Heading", type: "text" },
      { name: "body", label: "Body", type: "textarea", required: true, help: "Blank line separates paragraphs." },
    ],
  },
  {
    type: "feature_grid",
    name: "Feature grid",
    description: "A grid of titled feature cards.",
    category: "content",
    component: FeatureGrid,
    props: [
      { name: "heading", label: "Heading", type: "text" },
      {
        name: "items",
        label: "Items",
        type: "list",
        itemFields: [
          { name: "title", label: "Title", type: "text", required: true },
          { name: "body", label: "Body", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "stats",
    name: "Stats",
    description: "A row of big numbers with labels.",
    category: "content",
    component: Stats,
    props: [
      {
        name: "items",
        label: "Items",
        type: "list",
        itemFields: [
          { name: "value", label: "Value", type: "text", required: true },
          { name: "label", label: "Label", type: "text", required: true },
        ],
      },
    ],
  },
  {
    type: "media",
    name: "Media",
    description: "A responsive image with an optional caption.",
    category: "media",
    component: Media,
    props: [
      { name: "image", label: "Image", type: "media", required: true },
      { name: "alt", label: "Alt text", type: "text" },
      { name: "caption", label: "Caption", type: "text" },
    ],
  },
  {
    type: "cta",
    name: "Call to action",
    description: "A highlighted banner with a button.",
    category: "content",
    component: Cta,
    props: [
      { name: "heading", label: "Heading", type: "text" },
      { name: "body", label: "Body", type: "textarea" },
      { name: "cta_label", label: "Button label", type: "text" },
      { name: "cta_href", label: "Button link", type: "url" },
    ],
  },
  {
    type: "embed",
    name: "Embed",
    description: "An embedded iframe (video, map, …).",
    category: "media",
    component: Embed,
    props: [
      { name: "src", label: "Source URL", type: "url", required: true },
      { name: "title", label: "Title", type: "text" },
    ],
  },
  {
    type: "code",
    name: "Code",
    description: "A titled, scrollable code/definition snippet.",
    category: "content",
    component: Code,
    props: [
      { name: "heading", label: "Heading", type: "text" },
      { name: "intro", label: "Intro", type: "textarea" },
      { name: "title", label: "File/title", type: "text" },
      { name: "language", label: "Language label", type: "text" },
      { name: "code", label: "Code", type: "code", required: true },
      { name: "caption", label: "Caption", type: "text" },
    ],
  },
];

const BY_TYPE = new Map<BlockType, RenderComponent>(BLOCK_MANIFESTS.map((m) => [m.type, m.component]));

/** Component for a block type, or undefined if unknown (renderer skips it). */
export function getBlockComponent(type: BlockType): RenderComponent | undefined {
  return BY_TYPE.get(type);
}
