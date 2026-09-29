import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabPanel } from '../src/composites/Tabs.js';
import { FormSection } from '../src/composites/FormSection.js';
import { FormRow } from '../src/composites/FormRow.js';
import { PageHeader } from '../src/composites/PageHeader.js';
import { Badge } from '../src/primitives/Badge.js';
import { Input } from '../src/primitives/Input.js';
import { expectHooked } from './hooked.js';

/** The hooks a record form is drawn by: a design reaches its tabs, its sections, its
 *  rows, its labels, its error text and its title only through these. */

describe('the hook check itself', () => {
  it('planted: a label drawn without its hook goes red beside a hooked one', () => {
    render(
      <>
        <FormRow controlId="a" label="hooked">
          <input id="a" />
        </FormRow>
        <label htmlFor="b">unhooked</label>
        <input id="b" />
      </>,
    );
    expectHooked(screen.getByText('hooked').closest('label'), 'field-label');
    expect(() => expectHooked(screen.getByText('unhooked'), 'field-label')).toThrow(/hook of <label>/);
  });
});

describe('Tabs', () => {
  const ITEMS = [
    { key: 'lines', label: 'Lines' },
    { key: 'payments', label: 'Payments', badge: <Badge color="error">2</Badge> },
  ];

  it('pairs each tab with its panel and reports the clicked key', () => {
    const onChange = vi.fn();
    render(
      <>
        <Tabs id="so" items={ITEMS} value="lines" onChange={onChange} />
        <TabPanel tabsId="so" tabKey="lines">
          rows
        </TabPanel>
      </>,
    );
    expectHooked(screen.getByRole('tablist'), 'tabs');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    tabs.forEach((tab) => expectHooked(tab, 'tab'));
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel');
    expectHooked(panel, 'tab-panel');
    expect(panel).toHaveAttribute('id', tabs[0]!.getAttribute('aria-controls'));
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    // The badge rides inside the tab, so a design can tone the tab by it; the kit itself
    // turns the unselected tab red by the badge's error colour.
    expectHooked(tabs[1]!.querySelector('[data-color="error"]'), 'badge');
    expect(tabs[1]!.className).toContain('[&:has([data-color=error])]:text-error');
    fireEvent.click(tabs[1]!);
    expect(onChange).toHaveBeenCalledWith('payments');
  });
});

describe('FormSection', () => {
  it('carries the section and title hooks and hides its rows while collapsed', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FormSection title="Totals" collapsible collapsed={false} onToggle={onToggle}>
        <p>Grand total</p>
      </FormSection>,
    );
    const section = screen.getByText('Grand total').closest('section');
    expectHooked(section, 'form-section');
    // The section sits on the kit card, so a design's rules on `card` and on
    // `[data-ui="card"] section > header` reach a form section as they reach every block.
    expectHooked(section!.parentElement, 'card');
    expectHooked(screen.getByRole('heading', { level: 3 }), 'form-section-title');
    const toggle = screen.getByRole('button', { name: 'Totals' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <FormSection title="Totals" collapsible collapsed onToggle={onToggle}>
        <p>Grand total</p>
      </FormSection>,
    );
    expect(screen.getByRole('button', { name: 'Totals' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Grand total')).toBeNull();
  });

  it('draws a static title as a plain heading', () => {
    render(
      <FormSection title="Totals">
        <p>Grand total</p>
      </FormSection>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Totals');
  });
});

describe('FormRow', () => {
  it('labels its control, keeps the action outside the label and hooks the error text', () => {
    render(
      <FormRow
        controlId="po"
        labelId="po-label"
        label="Customer PO"
        required
        labelAction={<button type="button">About</button>}
        error="A confirmed order needs the customer's PO number."
        errorId="po-error"
      >
        <Input id="po" aria-labelledby="po-label" aria-describedby="po-error" aria-invalid />
      </FormRow>,
    );
    const input = screen.getByRole('textbox');
    const row = input.closest('[data-ui="form-row"]');
    expectHooked(row, 'form-row');
    const label = screen.getByText('Customer PO').closest('label')!;
    expectHooked(label, 'field-label');
    expect(label).toHaveAttribute('for', 'po');
    expect(label).toHaveTextContent('*');
    expect(screen.getByRole('button', { name: 'About' }).closest('label')).toBeNull();
    const error = screen.getByRole('alert');
    expectHooked(error, 'field-error');
    expect(error).toHaveAttribute('id', 'po-error');
    expect(input).toHaveAccessibleDescription("A confirmed order needs the customer's PO number.");
    // A design reads the row's state off its control.
    expect(row!.querySelector('[aria-invalid="true"]')).toBe(input);
  });

  it('the Input field mode hooks its own error text the same way', () => {
    render(<Input label="Name" errorMessage="Required" />);
    expectHooked(screen.getByRole('alert'), 'field-error');
  });
});

describe('PageHeader of a record', () => {
  it('draws the eyebrow and the status beside the heading, outside it', () => {
    render(
      <PageHeader
        title="SO-0042"
        collapsed={false}
        eyebrow="Sales Order"
        status={<Badge variant="pill" color="success">confirmed</Badge>}
      />,
    );
    const header = screen.getByRole('banner');
    expectHooked(header.querySelector('[data-ui="page-header-eyebrow"]'), 'page-header-eyebrow');
    const status = header.querySelector('[data-ui="page-header-status"]');
    expectHooked(status, 'page-header-status');
    expectHooked(status!.firstElementChild, 'badge');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^SO-0042$/);
  });

  it('wraps the heading and truncates only the bar mirror, in one display font', () => {
    render(<PageHeader title="Order for a customer with a long name" collapsed={false} />);
    const heading = screen.getByRole('heading', { level: 1 }).className;
    // A record title is read whole; the mirror truncates because the bar has one line.
    expect(heading).toContain('text-balance');
    expect(heading).not.toContain('truncate');
    expect(document.querySelector('[data-ui="page-header-bar-title"]')!.className).toContain('truncate');
    // Every page title, list and record alike, is set in the display font.
    expect(heading).toContain('font-display');
  });

  it('sticks as a whole below the top bar by the height under its bar, and publishes the bar height', () => {
    // jsdom lays nothing out: the heights come from the hook each element carries. This
    // proves the classes and the variables, not that the bar stays pinned; a wrapper
    // around the header would confine it again and keep this test green.
    const heights: Record<string, number> = { 'page-header': 120, 'page-header-bar': 48 };
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return heights[this.getAttribute('data-ui') ?? ''] ?? 0;
      },
    });
    try {
      const { unmount } = render(
        <div data-testid="scroller" style={{ overflowY: 'auto', height: '200px' }}>
          <PageHeader title="SO-0042" collapsed={false} />
        </div>,
      );
      const header = screen.getByRole('banner');
      const scroller = screen.getByTestId('scroller');
      // The header stands with its title block under the top bar and the bar's band showing.
      expect(header.className).toContain('sticky top-[calc(var(--topbar-h,0px)_-_var(--page-header-rest-h,0px))] z-20');
      expect(header.style.getPropertyValue('--page-header-rest-h')).toBe('72px');
      // What pins under the bar (a form's tab strip) reads the bar's height off the scroll container.
      expect(scroller.style.getPropertyValue('--page-header-bar-h')).toBe('48px');
      unmount();
      expect(scroller.style.getPropertyValue('--page-header-bar-h')).toBe('');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
    }
  });

  it('renders no status slot without a status', () => {
    render(<PageHeader title="SO-0042" collapsed={false} />);
    expect(document.querySelector('[data-ui="page-header-status"]')).toBeNull();
    expect(document.querySelector('[data-ui="page-header-eyebrow"]')).toBeNull();
  });
});
