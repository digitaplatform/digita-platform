import type { BlockType } from "@/lib/types";
import type { BlockComponent, BlockManifest, PropField } from "@/catalog/types";
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
import { RECORD_FORM_INPUTS } from "./record-form";
import { PLUGIN_MANIFESTS } from "@/plugins";

/** The heading every marketing section opens with. */
const EYEBROW: PropField = { name: "eyebrow", label: "Eyebrow", type: "text" };
const HEADING: PropField = { name: "heading", label: "Heading", type: "text" };
const LEDE: PropField = { name: "lede", label: "Lede", type: "textarea" };

/** A call to action: `sheet` opens the contact sheet, `href` follows the link. */
const action = (name: string, label: string): PropField => ({
  name,
  label,
  type: "object",
  itemFields: [
    { name: "label", label: "Label", type: "text", required: true },
    { name: "action", label: "Action", type: "select", options: ["sheet", "href"] },
    { name: "href", label: "Link", type: "url" },
  ],
});
const STATUS: PropField = { name: "status", label: "Status", type: "select", options: ["available", "early_access", "coming"] };

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
    description: "A proof strip: up to four facts, each a value over its label, divided by hairlines.",
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
    description: "A glowing panel with a headline, a body and a button.",
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
  {
    type: "hero_brand",
    name: "Brand hero",
    description: "The opening section of a site: headline, lede, calls to action and the figure a plugin draws.",
    category: "content",
    component: HeroBrand,
    props: [
      EYEBROW,
      { ...HEADING, required: true },
      LEDE,
      action("primary", "Primary action"),
      action("secondary", "Secondary action"),
      {
        name: "visual",
        label: "Visual",
        type: "select",
        options: [...PLUGIN_MANIFESTS.map((plugin) => plugin.id), "none"],
        help: "The plugin that draws the figure; it reads its own props from this block.",
      },
      { name: "atmosphere", label: "Atmosphere", type: "select", options: ["data-rain", "none"] },
      {
        name: "rain",
        label: "Rain columns",
        type: "list",
        help: "Up to five columns of tokens, falling behind the hero with the data-rain atmosphere.",
        itemFields: [{ name: "tokens", label: "Tokens", type: "list", required: true }],
      },
    ],
  },
  {
    type: "pillars",
    name: "Pillars",
    description: "Three or four numbered steps or ideas, one card each.",
    category: "content",
    component: Pillars,
    props: [
      EYEBROW,
      HEADING,
      LEDE,
      {
        name: "items",
        label: "Items",
        type: "list",
        required: true,
        itemFields: [
          { name: "num", label: "Number", type: "text" },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "body", label: "Body", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "stack",
    name: "Product stack",
    description: "Products or apps, each with its lockup or title, its status and a link.",
    category: "content",
    component: Stack,
    props: [
      EYEBROW,
      HEADING,
      LEDE,
      {
        name: "items",
        label: "Items",
        type: "list",
        required: true,
        itemFields: [
          {
            name: "lockup",
            label: "Lockup",
            type: "object",
            help: "A family product: family and product word, both lowercase. Leave empty to show the title.",
            itemFields: [
              { name: "family", label: "Family", type: "text", required: true },
              { name: "product", label: "Product", type: "text", required: true },
            ],
          },
          { name: "title", label: "Title", type: "text" },
          { name: "body", label: "Body", type: "textarea" },
          STATUS,
          { name: "href", label: "Link", type: "url" },
          { name: "link_label", label: "Link label", type: "text" },
        ],
      },
    ],
  },
  {
    type: "pipeline",
    name: "Pipeline",
    description: "The stages of a process in order, one column each.",
    category: "content",
    component: Pipeline,
    props: [
      EYEBROW,
      HEADING,
      LEDE,
      {
        name: "stages",
        label: "Stages",
        type: "list",
        required: true,
        itemFields: [
          { name: "stage", label: "Stage", type: "text", help: "Its number, e.g. 01." },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "body", label: "Body", type: "textarea" },
          { name: "target", label: "Target", type: "text", help: "How long it takes, e.g. days." },
        ],
      },
    ],
  },
  {
    type: "compare",
    name: "Comparison",
    description: "Two approaches compared row by row; the second column is the one the page argues for.",
    category: "content",
    component: Compare,
    props: [
      EYEBROW,
      HEADING,
      LEDE,
      { name: "columns", label: "Column names", type: "list", required: true, help: "Two lines: the first and the second column." },
      {
        name: "rows",
        label: "Rows",
        type: "list",
        required: true,
        itemFields: [
          { name: "aspect", label: "Aspect", type: "text", required: true },
          { name: "a", label: "First column", type: "textarea" },
          { name: "b", label: "Second column", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "checklist",
    name: "Checklist",
    description: "What is included, as a checked list in two or three columns.",
    category: "content",
    component: Checklist,
    props: [
      EYEBROW,
      HEADING,
      {
        name: "items",
        label: "Items",
        type: "list",
        required: true,
        itemFields: [
          { name: "what", label: "What", type: "text", required: true },
          { name: "note", label: "Note", type: "text" },
        ],
      },
    ],
  },
  {
    type: "segments",
    name: "Segments",
    description: "Who a product is for: each audience, who they are and what they gain.",
    category: "content",
    component: Segments,
    props: [
      EYEBROW,
      HEADING,
      LEDE,
      {
        name: "items",
        label: "Items",
        type: "list",
        required: true,
        itemFields: [
          { name: "mark", label: "Mark", type: "text" },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "who", label: "Who they are", type: "textarea" },
          { name: "gain", label: "What they gain", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "signals",
    name: "Signals",
    description: "A row of chips a visitor recognizes themselves in, with a note line.",
    category: "content",
    component: Signals,
    props: [
      EYEBROW,
      { name: "items", label: "Chips", type: "list", required: true },
      { name: "note", label: "Note", type: "text" },
    ],
  },
  {
    type: "cta_panel",
    name: "Call to action panel",
    description: "A glowing panel with a headline, a body and up to two actions.",
    category: "content",
    component: CtaPanel,
    props: [
      { ...HEADING, required: true },
      { name: "body", label: "Body", type: "textarea" },
      action("primary", "Primary action"),
      action("secondary", "Secondary action"),
    ],
  },
  {
    type: "contact_details",
    name: "Contact details",
    description: "The address, email and phone, with a booking button once a booking link exists.",
    category: "content",
    component: ContactDetails,
    props: [
      HEADING,
      { name: "body", label: "Body", type: "textarea" },
      { name: "address", label: "Address lines", type: "list", required: true },
      { name: "email", label: "Email", type: "text" },
      { name: "phone", label: "Phone", type: "text" },
      { name: "booking_url", label: "Booking link", type: "url" },
      { name: "booking_label", label: "Booking button label", type: "text" },
    ],
  },
  {
    type: "showcase",
    name: "Showcase",
    description: "A live plugin under a section heading, with a caption.",
    category: "interactive",
    component: Showcase,
    props: [
      EYEBROW,
      HEADING,
      LEDE,
      { name: "plugin_id", label: "Plugin", type: "select", required: true, options: PLUGIN_MANIFESTS.map((plugin) => plugin.id) },
      { name: "caption", label: "Caption", type: "text" },
    ],
  },
  {
    type: "record_form",
    name: "Record form",
    description: "A form that creates one record of an entity through the Guest create of its engine, then thanks the visitor.",
    category: "interactive",
    component: RecordForm,
    props: [
      EYEBROW,
      HEADING,
      LEDE,
      { name: "app", label: "App", type: "text", help: "The tenant app whose engine holds the entity; empty for the site's own engine." },
      { name: "entity", label: "Entity", type: "text", required: true, help: "Its Guest row grants create, and write on every field below." },
      {
        name: "fields",
        label: "Fields",
        type: "list",
        required: true,
        help: "In the order the form shows them.",
        itemFields: [
          { name: "name", label: "Field", type: "text", required: true, help: "The entity's field name." },
          { name: "label", label: "Label", type: "text", help: "Required unless the input is hidden." },
          { name: "type", label: "Input", type: "select", options: [...RECORD_FORM_INPUTS], help: "Empty for a line of text." },
          { name: "required", label: "Required", type: "boolean" },
          { name: "max_length", label: "Max length", type: "number" },
          {
            name: "options",
            label: "Options",
            type: "list",
            help: "The choices of a select, the first chosen at the start.",
            itemFields: [
              { name: "value", label: "Value", type: "text", required: true },
              { name: "label", label: "Label", type: "text", required: true },
            ],
          },
          { name: "value", label: "Value", type: "text", help: "What a hidden input sends, such as the page's language." },
        ],
      },
      { name: "send_label", label: "Button label", type: "text" },
      { name: "thanks", label: "Thank-you text", type: "textarea", help: "Shown in place of the form once the record is created." },
    ],
  },
];

const BY_TYPE = new Map<BlockType, BlockComponent>(BLOCK_MANIFESTS.map((m) => [m.type, m.component]));

/** Component for a block type, or undefined if unknown (renderer skips it). */
export function getBlockComponent(type: BlockType): BlockComponent | undefined {
  return BY_TYPE.get(type);
}
