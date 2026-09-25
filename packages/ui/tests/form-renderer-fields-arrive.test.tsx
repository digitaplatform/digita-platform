// @vitest-environment jsdom
// A form whose fields arrive after its first render (the entity meta loads after the page mounts)
// renders them. FormRenderer returned early for "no fields" before some of its hooks, so the
// second render called more hooks than the first and React threw.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FieldDefinition } from '@digitaplatform/shared';
import { FormRenderer } from '@/components/render/FormRenderer';

function form(fields: FieldDefinition[]) {
  return (
    <MemoryRouter>
      <FormRenderer entity="Customer" fields={fields} doc={{}} fieldState={{}} errors={{}} onFieldChange={() => {}} />
    </MemoryRouter>
  );
}

describe('FormRenderer', () => {
  it('renders the fields that arrive after a first render with none', () => {
    const { rerender } = render(form([]));
    rerender(form([{ fieldname: 'note', fieldtype: 'Data', label: 'Note' } as FieldDefinition]));
    expect(screen.getByText('Note')).toBeInTheDocument();
  });
});
