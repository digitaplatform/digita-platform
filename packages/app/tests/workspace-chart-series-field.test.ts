import { describe, it, expect, expectTypeOf } from 'vitest';
import type { ChartCard } from '@digitaplatform/shared';
import { validateWorkspaceCards } from '@/lib/workspace-schema';

/**
 * A chart card draws one series per entry of y_fields and none per value of a field. An author
 * who set series_field to get one line per genre got the y_fields series without a word, so the
 * card offers no such key, and a workspace whose chart card sets it fails to load, naming it.
 */

const CHART = {
  id: 'genres',
  kind: 'chart',
  label: 'Books per genre',
  section: 'per_genre',
  chart_type: 'line',
  x_field: 'month',
  y_fields: ['books'],
};

describe('series_field on a chart card', () => {
  it('is no key of the card', () => {
    expectTypeOf<ChartCard>().not.toHaveProperty('series_field');
  });

  it('PLANTED DEFECT: fails the workspace that sets it, naming the card and the key', () => {
    expect(() => validateWorkspaceCards([{ ...CHART, series_field: 'genre' }])).toThrow(
      /^workspace_cards_invalid: 0\.series_field: .*y_fields/,
    );
  });

  it('PLANTED INNOCENT: passes a chart card without it, and a stacked chart card', () => {
    const stacked = { ...CHART, id: 'genres-stacked', chart_type: 'bar', stacked: true };
    expect(validateWorkspaceCards([CHART, stacked])).toEqual([CHART, stacked]);
  });
});
