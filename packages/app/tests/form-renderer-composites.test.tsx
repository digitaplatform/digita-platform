// @vitest-environment jsdom
// The form draws its tabs, sections, rows and read-only fields through the kit composites;
// switching a tab, collapsing a section and the error text under a field keep working.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldStateMap } from '@/lib/evaluate-field';
import { FormRenderer } from '@/components/render/FormRenderer';

const FIELDS = [
  { fieldname: 'tab_order', fieldtype: 'TabBreak', label: 'Order' },
  { fieldname: 'customer', fieldtype: 'Data', label: 'Customer' },
  { fieldname: 'sec_totals', fieldtype: 'SectionBreak', label: 'Totals', collapsible: true },
  { fieldname: 'grand_total', fieldtype: 'Data', label: 'Grand total', read_only: true },
  { fieldname: 'remarks', fieldtype: 'Data', label: 'Remarks' },
  { fieldname: 'tab_history', fieldtype: 'TabBreak', label: 'History' },
  { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
] as FieldDefinition[];

const STATE: FieldStateMap = Object.fromEntries(
  FIELDS.map((f) => [
    f.fieldname,
    { visible: true, required: false, readOnly: f.read_only === true, invalid: false, isComputed: false, isFrozen: false, updating: false },
  ]),
);

function form(errors: Record<string, string> = {}) {
  return (
    <MemoryRouter>
      <FormRenderer
        entity="SalesOrder"
        fields={FIELDS}
        doc={{ grand_total: '€1,886.15' }}
        fieldState={STATE}
        errors={errors}
        onFieldChange={() => {}}
        tabsClassName="sticky"
      />
    </MemoryRouter>
  );
}

describe('FormRenderer through the kit composites', () => {
  it('hands the page the tab strip element through tabsRef', () => {
    const strip = vi.fn();
    render(
      <MemoryRouter>
        <FormRenderer
          entity="SalesOrder"
          fields={FIELDS}
          doc={{}}
          fieldState={STATE}
          errors={{}}
          onFieldChange={() => {}}
          tabsRef={strip}
        />
      </MemoryRouter>,
    );
    expect(strip).toHaveBeenCalledWith(screen.getByRole('tablist'));
  });

  it('switches tabs and collapses a section', async () => {
    render(form());
    const [order, history] = screen.getAllByRole('tab');
    expect(order).toHaveAttribute('aria-selected', 'true');
    // The page, not the renderer, decides where the strip pins.
    expect(screen.getByRole('tablist')).toHaveClass('sticky');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', order!.id);
    // Controls load lazily, so the first control of a tab is awaited.
    expect(await screen.findByLabelText('Customer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Note')).toBeNull();

    fireEvent.click(history!);
    expect(history).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText('Note')).toBeInTheDocument();
    expect(screen.queryByLabelText('Customer')).toBeNull();

    fireEvent.click(order!);
    const toggle = screen.getByRole('button', { name: 'Totals' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByLabelText('Grand total')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Grand total')).toBeNull();
  });

  it('draws a read-only field as the locked kit input and the error text as an alert', async () => {
    render(form({ customer: 'Pick a customer.' }));
    const total = await screen.findByLabelText('Grand total');
    expect(total).toHaveAttribute('readonly');
    expect(total).toHaveAttribute('data-ui', 'input');
    expect(total).toHaveValue('€1,886.15');
    // The Order tab counts its one error.
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Order1');
    const error = screen.getByRole('alert');
    expect(error).toHaveAttribute('data-ui', 'field-error');
    const customer = await screen.findByLabelText('Customer');
    expect(customer).toHaveAccessibleDescription('Pick a customer.');
    expect(error.closest('[data-ui="form-row"]')).toContainElement(customer);
  });

  it('keeps a read-only field in the tab order, after the field before it and before the next', async () => {
    const user = userEvent.setup();
    render(form());
    const total = await screen.findByLabelText('Grand total');
    const remarks = await screen.findByLabelText('Remarks');
    // Its value must be selectable and readable by assistive technology, like a locked Data field.
    // The section's toggle is the tab stop before it.
    screen.getByRole('button', { name: 'Totals' }).focus();
    await user.tab();
    expect(total).toHaveFocus();
    await user.tab();
    expect(remarks).toHaveFocus();
  });
});
