// @vitest-environment jsdom
// A Data field of format "Icon", such as the tree block's icon: the form offers every lucide icon
// name as a person types and shows the icon the name draws.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FieldDefinition } from '@digitaplatform/shared';
import DataControl from '@/controls/DataControl';
import type { FieldControlState } from '@/controls/types';

const STATE: FieldControlState = { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false };

function renderField(options: string | undefined, value: string) {
  const field = { fieldname: 'icon', fieldtype: 'Data', label: 'Icon', options } as FieldDefinition;
  return render(<DataControl field={field} value={value} state={STATE} onChange={vi.fn()} controlId="icon" labelId="icon-label" doc={{}} entity="TreeNode" />);
}

describe('the Icon format of a Data field', () => {
  it('offers the lucide icon names and shows the icon the value names', async () => {
    const { container } = renderField('Icon', 'shopping-cart');
    const input = await screen.findByRole('combobox');
    const list = container.querySelector(`datalist#${CSS.escape(input.getAttribute('list')!)}`);
    expect(list?.querySelector('option[value="shopping-cart"]')).not.toBeNull();
    expect(container.querySelector('[data-component="icon-preview"] svg.lucide-shopping-cart')).not.toBeNull();
  });

  it('PLANTED INNOCENT: a plain Data field stays a text input without a list', () => {
    const { container } = renderField(undefined, 'shopping-cart');
    expect(container.querySelector('datalist')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('shopping-cart');
  });
});
