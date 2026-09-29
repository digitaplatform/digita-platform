// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * The applied filter chip reads "field op value" inside the kit Chip. The kit
 * or a design paints the chip's text color for the mode through data-ui="chip";
 * the value must follow that color, never carry a primary ramp step of its own
 * (the ramp is mode-static, so #00499d stays on a dark surface), and it carries
 * the hook chip-value so a design can style it apart from the label.
 */

vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tField: (_e: string, _f: string, label: string) => label, tOption: (_e: string, _f: string, o: string) => o }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { FilterChip } from '@/components/list/FilterChip';

const META = {
  name: 'Widget',
  module: 'core',
  database: 'app',
  naming: { strategy: 'system' },
  fields: [{ fieldname: 'status', fieldtype: 'Data', label: 'Status' }],
  permissions: [],
} as unknown as EntityDefinition;

describe('FilterChip', () => {
  it('hooks the value as chip-value and lets it inherit the chip color', () => {
    render(<FilterChip meta={META} filter={['status', '=', 'Open']} onRemove={() => {}} />);
    const value = document.querySelector('[data-ui="chip"] [data-ui="chip-value"]');
    expect(value, 'an element hooked as chip-value').not.toBeNull();
    expect(value).toHaveTextContent('Open');
    expect(value!.className).not.toMatch(/text-primary-\d+/);
  });
});
