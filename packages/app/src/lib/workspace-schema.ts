import { z } from 'zod';
import type { WorkspaceCard } from '@digitaplatform/shared';

/**
 * Fail-loud validation of a Workspace's `cards` blob. A misconfigured card (unknown
 * kind, missing value_field/x_field/section, …) throws `workspace_cards_invalid` so
 * DashboardPage shows a loud error instead of silently rendering garbage.
 */

const width = z.union([z.literal(1), z.literal(2), z.literal(3)]).optional();
const base = {
  id: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  width,
  on_data_error: z.enum(['empty', 'error']).optional(),
};
const viewBound = {
  ...base,
  view: z.string().optional(),
  section: z.string().min(1),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
};

const numberCard = z.object({
  ...viewBound,
  kind: z.literal('number'),
  value_field: z.string().min(1),
  format: z.enum(['integer', 'decimal', 'currency', 'percent']).optional(),
  currency_field: z.string().optional(),
  trend_field: z.string().optional(),
  deep_link: z.string().optional(),
});
const chartCard = z.object({
  ...viewBound,
  kind: z.literal('chart'),
  chart_type: z.enum(['bar', 'line', 'area', 'pie', 'donut']),
  x_field: z.string().min(1),
  y_fields: z.array(z.string()).min(1),
  series_field: z.string().optional(),
  stacked: z.boolean().optional(),
});
const listCard = z.object({
  ...viewBound,
  kind: z.literal('list'),
  columns: z.array(z.string()).optional(),
  limit: z.number().optional(),
  deep_link: z.string().optional(),
});
const shortcutCard = z.object({
  ...base,
  kind: z.literal('shortcut'),
  to: z.string().min(1),
  description: z.string().optional(),
  count_view: z.string().optional(),
  count_section: z.string().optional(),
  count_field: z.string().optional(),
});
const linksCard = z.object({
  ...base,
  kind: z.literal('links'),
  links: z.array(
    z.object({
      label: z.string(),
      to: z.string().optional(),
      href: z.string().optional(),
      icon: z.string().optional(),
    }),
  ),
});

const cardSchema = z.discriminatedUnion('kind', [
  numberCard,
  chartCard,
  listCard,
  shortcutCard,
  linksCard,
]);

export function validateWorkspaceCards(raw: unknown): WorkspaceCard[] {
  const result = z.array(cardSchema).safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`workspace_cards_invalid: ${detail}`);
  }
  return result.data as WorkspaceCard[];
}
