import { useEffect, useId, useState } from 'react';
import { Check, FileText, Pencil, Plus } from 'lucide-react';
import {
  Badge,
  BaseDialog,
  Button,
  Chip,
  CommandPalette,
  DataGrid,
  DatePicker,
  Input,
  SegmentedControl,
  Select,
  Switch,
  type BadgeProps,
  type DataGridColumn,
} from '@digitaplatform/components';
import { ShowcaseGroup, ShowcaseOpener } from './ShowcaseGroup';

type OrderStatus = 'draft' | 'confirmed' | 'delivered';
type Order = { number: string; customer: string; status: OrderStatus; total: string };

const ORDERS: Order[] = [
  { number: 'SO-0044', customer: 'Bergwerk AG', status: 'draft', total: '€512.30' },
  { number: 'SO-0043', customer: 'Nordlicht Media', status: 'delivered', total: '€980.00' },
  { number: 'SO-0042', customer: 'ACME GmbH', status: 'confirmed', total: '€1,886.15' },
  { number: 'SO-0041', customer: 'Helvetia Sports', status: 'delivered', total: '€3,240.00' },
  { number: 'SO-0040', customer: 'Aurora Retail', status: 'draft', total: '€140.00' },
];

const STATUS_COLOR: Record<OrderStatus, NonNullable<BadgeProps['color']>> = {
  draft: 'neutral',
  confirmed: 'primary',
  delivered: 'success',
};

const ORDER_COLUMNS: DataGridColumn[] = [
  { key: 'number', label: 'Number', kind: 'link' },
  { key: 'customer', label: 'Customer', kind: 'text' },
  { key: 'status', label: 'Status', kind: 'select' },
  { key: 'total', label: 'Total', kind: 'currency', align: 'end' },
];

const CUSTOMER_OPTIONS = ORDERS.map((o) => ({ value: o.customer, label: o.customer }));

const PALETTE_ITEMS = [
  { id: 'confirm', group: 'Actions', label: 'Confirm SO-0042', icon: <Check className="h-4 w-4" />, shortcut: '↵' },
  { id: 'edit', group: 'Actions', label: 'Edit confirmation text', icon: <Pencil className="h-4 w-4" /> },
  { id: 'confirmed', group: 'Records', label: 'Confirmed orders (12)', icon: <FileText className="h-4 w-4" /> },
  { id: 'templates', group: 'Records', label: 'Confirmation templates', icon: <FileText className="h-4 w-4" /> },
];

const noop = () => {};

function ListSurface() {
  return (
    <ShowcaseGroup title="List surface" exports={['DataGrid', 'Chip', 'Badge']}>
      <div className="w-full space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-textMain">Sales orders</span>
          <Badge size="sm">42</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip selected onRemove={noop} removeLabel="Remove">
            Status: confirmed
          </Chip>
          <Chip onClick={noop} icon={<Plus className="h-3.5 w-3.5" />}>
            Filter
          </Chip>
        </div>
        <DataGrid<Order>
          aria-label="Sales orders"
          editable={false}
          rows={ORDERS}
          columns={ORDER_COLUMNS}
          getRowId={(o) => o.number}
          renderDisplay={({ row, column }) =>
            column.key === 'status' ? (
              <Badge color={STATUS_COLOR[row.status]}>{row.status}</Badge>
            ) : (
              String(row[column.key as keyof Order])
            )
          }
        />
      </div>
    </ShowcaseGroup>
  );
}

function RecordFormSurface() {
  const orderDateId = useId();
  const [customer, setCustomer] = useState('ACME GmbH');
  const [orderDate, setOrderDate] = useState<string | undefined>('2026-09-28');
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [view, setView] = useState('lines');

  // The canvas shows the order date focused; one element of a page can hold focus.
  useEffect(() => {
    document.getElementById(orderDateId)?.focus({ preventScroll: true });
  }, [orderDateId]);

  return (
    <ShowcaseGroup
      title="Record form surface"
      exports={['Select', 'DatePicker', 'Input', 'Switch', 'SegmentedControl', 'Button', 'Badge']}
    >
      <div className="w-full max-w-xl space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-h2 text-textMain">SO-0042</span>
          <Badge color="primary">confirmed</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Customer" value={customer} onChange={setCustomer} options={CUSTOMER_OPTIONS} />
          <div className="flex flex-col gap-1.5">
            <span id={`${orderDateId}-label`} className="text-xs font-medium text-textMuted">
              Order date · focus
            </span>
            <DatePicker
              id={orderDateId}
              aria-labelledby={`${orderDateId}-label`}
              value={orderDate}
              onChange={setOrderDate}
              locale="en-GB"
            />
          </div>
          <Input
            name="surface_customer_po"
            label="Customer PO · invalid"
            errorMessage="A confirmed order needs the customer's PO number."
          />
          <Input name="surface_grand_total" label="Grand total · read-only" readOnly value="€1,886.15" />
        </div>
        <Switch checked={sendConfirmation} onChange={setSendConfirmation} label="Send confirmation" />
        <SegmentedControl
          aria-label="Order view"
          value={view}
          onChange={setView}
          options={[
            { value: 'lines', label: 'Lines' },
            { value: 'payments', label: 'Payments' },
            { value: 'history', label: 'History' },
          ]}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary">Cancel</Button>
          <Button>Save</Button>
        </div>
      </div>
    </ShowcaseGroup>
  );
}

function DialogSurface() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <ShowcaseGroup title="Dialog surface" exports={['BaseDialog', 'Button']}>
      <ShowcaseOpener open={open} onToggle={() => setOpen((o) => !o)}>
        Open “Submit SO-0042?”
      </ShowcaseOpener>
      <BaseDialog
        open={open}
        onClose={close}
        title="Submit SO-0042?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Not yet
            </Button>
            <Button onClick={close}>Submit</Button>
          </>
        }
      >
        <p>
          Submitting freezes the customer and the prices on this order and books it into the open period.
        </p>
      </BaseDialog>
    </ShowcaseGroup>
  );
}

function CommandPaletteSurface() {
  const [open, setOpen] = useState(false);
  return (
    <ShowcaseGroup title="Command palette surface" exports={['CommandPalette']}>
      <ShowcaseOpener open={open} onToggle={() => setOpen((o) => !o)}>
        Open the command palette
      </ShowcaseOpener>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        items={PALETTE_ITEMS}
        onSelect={() => setOpen(false)}
        placeholder="Type a command or search…"
      />
    </ShowcaseGroup>
  );
}

/**
 * The four surfaces of the approved designs canvas, built from the kit: a sales
 * order list, the order's record form, the submit dialog and the command palette.
 * The dialog and the palette cover the whole page when open, so each opens on
 * demand instead of at mount.
 */
export function DesignSurfaces() {
  return (
    <>
      <ListSurface />
      <RecordFormSurface />
      <DialogSurface />
      <CommandPaletteSurface />
    </>
  );
}
