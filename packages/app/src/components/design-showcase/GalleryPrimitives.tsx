import { useRef, useState } from 'react';
import { Archive, Copy, Pin, Plus, Tag, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Checkbox,
  Chip,
  Fab,
  IconButton,
  Input,
  Popover,
  PullToRefresh,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  SwipeRow,
  Switch,
  TextField,
  Tooltip,
} from '@digitaplatform/components';
import { ShowcaseGroup, ShowcaseOpener, ShowcaseState } from './ShowcaseGroup';

const CUSTOMERS = [
  { value: 'bergwerk', label: 'Bergwerk AG' },
  { value: 'nordlicht', label: 'Nordlicht Media' },
  { value: 'acme', label: 'ACME GmbH' },
  { value: 'helvetia', label: 'Helvetia Sports', disabled: true },
];

const ORDER_VIEWS = [
  { value: 'lines', label: 'Lines' },
  { value: 'payments', label: 'Payments' },
  { value: 'history', label: 'History' },
];

const noop = () => {};

function ButtonGroup() {
  return (
    <ShowcaseGroup title="Button" exports={['Button']}>
      {(['primary', 'secondary', 'outline', 'ghost', 'danger'] as const).map((variant) => (
        <ShowcaseState key={variant} state={`${variant} · rest`}>
          <Button variant={variant}>Save order</Button>
        </ShowcaseState>
      ))}
      <ShowcaseState state="disabled">
        <Button disabled>Save order</Button>
      </ShowcaseState>
      <ShowcaseState state="loading">
        <Button loading>Save order</Button>
      </ShowcaseState>
      <ShowcaseState state="with icon · sm">
        <Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>
          New order
        </Button>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function IconButtonGroup() {
  return (
    <ShowcaseGroup title="IconButton" exports={['IconButton']}>
      {(['ghost', 'secondary', 'primary', 'danger'] as const).map((variant) => (
        <ShowcaseState key={variant} state={`${variant} · rest`}>
          <IconButton variant={variant} label="Duplicate order" icon={<Copy className="h-4 w-4" />} />
        </ShowcaseState>
      ))}
      <ShowcaseState state="disabled">
        <IconButton disabled label="Delete order" icon={<Trash2 className="h-4 w-4" />} />
      </ShowcaseState>
      <ShowcaseState state="loading">
        <IconButton loading label="Delete order" icon={<Trash2 className="h-4 w-4" />} />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function InputGroup() {
  return (
    <ShowcaseGroup title="Input" exports={['Input']}>
      <ShowcaseState state="rest · bare">
        <Input placeholder="Customer PO" className="w-56" />
      </ShowcaseState>
      <ShowcaseState state="rest · field">
        <Input name="gallery_po_rest" label="Customer PO" placeholder="PO-2026-118" wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="invalid">
        <Input
          name="gallery_po_invalid"
          label="Customer PO"
          errorMessage="A confirmed order needs the customer's PO number."
          wrapperClassName="w-56"
        />
      </ShowcaseState>
      <ShowcaseState state="invalid · bare">
        <Input error defaultValue="PO-?" className="w-56" />
      </ShowcaseState>
      <ShowcaseState state="read-only">
        <Input name="gallery_grand_total" label="Grand total" readOnly value="€1,886.15" wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="disabled">
        <Input name="gallery_order_number" label="Order number" disabled value="SO-0042" wrapperClassName="w-56" />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function TextFieldGroup() {
  return (
    <ShowcaseGroup title="TextField" exports={['TextField']}>
      <ShowcaseState state="rest">
        <TextField label="Contact email" wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="filled">
        <TextField label="Contact email" defaultValue="orders@acme.example" leftIcon={<Tag className="h-4 w-4" />} wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="invalid">
        <TextField label="Contact email" defaultValue="orders@" errorMessage="Enter a full email address." wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="read-only">
        <TextField label="Order number" readOnly value="SO-0042" wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="disabled">
        <TextField label="Order number" disabled value="SO-0042" wrapperClassName="w-56" />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function SelectGroup() {
  const [customer, setCustomer] = useState('acme');
  return (
    <ShowcaseGroup title="Select" exports={['Select']}>
      <ShowcaseState state="rest · placeholder">
        <Select value="" onChange={noop} options={CUSTOMERS} placeholder="Choose a customer" aria-label="Customer" wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="selected · click opens">
        <Select label="Customer" value={customer} onChange={setCustomer} options={CUSTOMERS} wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="searchable · click opens">
        <Select label="Customer" value={customer} onChange={setCustomer} options={CUSTOMERS} searchable searchPlaceholder="Search customers" wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="invalid">
        <Select label="Customer" value="" onChange={noop} options={CUSTOMERS} invalid placeholder="Required" wrapperClassName="w-56" />
      </ShowcaseState>
      <ShowcaseState state="disabled">
        <Select label="Customer" value="acme" onChange={noop} options={CUSTOMERS} disabled wrapperClassName="w-56" />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function CheckboxGroup() {
  return (
    <ShowcaseGroup title="Checkbox" exports={['Checkbox']}>
      <ShowcaseState state="rest">
        <Checkbox label="Partial delivery" />
      </ShowcaseState>
      <ShowcaseState state="checked">
        <Checkbox label="Partial delivery" defaultChecked />
      </ShowcaseState>
      <ShowcaseState state="indeterminate">
        <Checkbox label="All lines" indeterminate />
      </ShowcaseState>
      <ShowcaseState state="disabled">
        <Checkbox label="Partial delivery" disabled />
      </ShowcaseState>
      <ShowcaseState state="disabled · checked">
        <Checkbox label="Partial delivery" disabled defaultChecked />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function SwitchGroup() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  return (
    <ShowcaseGroup title="Switch" exports={['Switch']}>
      <ShowcaseState state="off">
        <Switch checked={off} onChange={setOff} label="Send confirmation" />
      </ShowcaseState>
      <ShowcaseState state="on">
        <Switch checked={on} onChange={setOn} label="Send confirmation" />
      </ShowcaseState>
      <ShowcaseState state="disabled · off">
        <Switch checked={false} onChange={noop} disabled label="Send confirmation" />
      </ShowcaseState>
      <ShowcaseState state="disabled · on">
        <Switch checked onChange={noop} disabled label="Send confirmation" />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function SegmentedControlGroup() {
  const [view, setView] = useState('lines');
  return (
    <ShowcaseGroup title="SegmentedControl" exports={['SegmentedControl']}>
      <ShowcaseState state="selected · md">
        <SegmentedControl aria-label="Order view" value={view} onChange={setView} options={ORDER_VIEWS} />
      </ShowcaseState>
      <ShowcaseState state="selected · sm">
        <SegmentedControl aria-label="Order view" size="sm" value={view} onChange={setView} options={ORDER_VIEWS} />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function ChipGroup() {
  return (
    <ShowcaseGroup title="Chip" exports={['Chip']}>
      <ShowcaseState state="rest">
        <Chip onClick={noop}>Status: draft</Chip>
      </ShowcaseState>
      <ShowcaseState state="selected">
        <Chip selected onClick={noop}>
          Status: confirmed
        </Chip>
      </ShowcaseState>
      <ShowcaseState state="removable">
        <Chip selected onRemove={noop} removeLabel="Remove">
          Customer: ACME GmbH
        </Chip>
      </ShowcaseState>
      <ShowcaseState state="with icon">
        <Chip onClick={noop} icon={<Plus className="h-3.5 w-3.5" />}>
          Filter
        </Chip>
      </ShowcaseState>
      <ShowcaseState state="categorical">
        <Chip color="cat-3" onClick={noop}>
          Wholesale
        </Chip>
      </ShowcaseState>
      <ShowcaseState state="disabled">
        <Chip disabled onClick={noop}>
          Status: cancelled
        </Chip>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function BadgeGroup() {
  const colors = ['neutral', 'primary', 'info', 'success', 'warning', 'error'] as const;
  return (
    <ShowcaseGroup title="Badge" exports={['Badge']}>
      {(['soft', 'outline', 'pill'] as const).map((variant) => (
        <ShowcaseState key={variant} state={variant}>
          <div className="flex flex-wrap gap-1.5">
            {colors.map((color) => (
              <Badge key={color} variant={variant} color={color}>
                {color}
              </Badge>
            ))}
          </div>
        </ShowcaseState>
      ))}
      <ShowcaseState state="categorical · lg">
        <Badge color="cat-5" size="lg">
          Wholesale
        </Badge>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function CardGroup() {
  const body = (
    <>
      <CardHeader>SO-0042</CardHeader>
      <CardContent>ACME GmbH · €1,886.15</CardContent>
      <CardFooter>Confirmed on 28 Sep 2026</CardFooter>
    </>
  );
  return (
    <ShowcaseGroup title="Card" exports={['Card', 'CardHeader', 'CardContent', 'CardFooter']}>
      {(['default', 'interactive', 'elevated', 'flat'] as const).map((variant) => (
        <ShowcaseState key={variant} state={`variant ${variant}`}>
          <Card variant={variant} className="w-56">
            {body}
          </Card>
        </ShowcaseState>
      ))}
      {(['raised', 'floating'] as const).map((elevation) => (
        <ShowcaseState key={elevation} state={`elevation ${elevation}`}>
          <Card elevation={elevation} className="w-56">
            {body}
          </Card>
        </ShowcaseState>
      ))}
    </ShowcaseGroup>
  );
}

function FabGroup() {
  const [shown, setShown] = useState<'none' | 'round' | 'extended'>('none');
  const toggle = (kind: 'round' | 'extended') => setShown((s) => (s === kind ? 'none' : kind));
  return (
    <ShowcaseGroup title="Fab" exports={['Fab']}>
      <ShowcaseState state="round · docks bottom right">
        <ShowcaseOpener open={shown === 'round'} onToggle={() => toggle('round')}>
          Show round
        </ShowcaseOpener>
      </ShowcaseState>
      <ShowcaseState state="extended · docks bottom right">
        <ShowcaseOpener open={shown === 'extended'} onToggle={() => toggle('extended')}>
          Show extended
        </ShowcaseOpener>
      </ShowcaseState>
      {shown !== 'none' && (
        <Fab label="New order" icon={<Plus className="h-5 w-5" />} onClick={noop} extended={shown === 'extended'} />
      )}
    </ShowcaseGroup>
  );
}

function TooltipGroup() {
  return (
    <ShowcaseGroup title="Tooltip" exports={['Tooltip']}>
      <ShowcaseState state="top · opens on hover or focus">
        <Tooltip label="Duplicate the order with its lines">
          <Button variant="secondary">Duplicate</Button>
        </Tooltip>
      </ShowcaseState>
      <ShowcaseState state="bottom · multiline">
        <Tooltip
          side="bottom"
          multiline
          label="Submitting freezes the customer and the prices and books the order into the open period."
        >
          <Button variant="secondary">Submit</Button>
        </Tooltip>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function PopoverGroup() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <ShowcaseGroup title="Popover" exports={['Popover']}>
      <ShowcaseState state="open">
        <ShowcaseOpener open={open} onToggle={() => setOpen((o) => !o)} buttonRef={anchorRef}>
          Delivery details
        </ShowcaseOpener>
        <Popover open={open} anchorRef={anchorRef} onRequestClose={() => setOpen(false)} className="w-64 p-3 text-sm text-textMain">
          Ships from Basel on 30 Sep 2026, two parcels.
        </Popover>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function LoadingGroup() {
  return (
    <ShowcaseGroup title="Spinner, Skeleton" exports={['Spinner', 'Skeleton']}>
      <ShowcaseState state="Spinner">
        <Spinner className="h-6 w-6 text-primary-600" />
      </ShowcaseState>
      <ShowcaseState state="Skeleton">
        <div className="w-56 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function SwipeRowGroup() {
  return (
    <ShowcaseGroup title="SwipeRow" exports={['SwipeRow']}>
      <ShowcaseState state="rest · swipe on touch, menu with a mouse">
        <SwipeRow
          className="w-80 rounded-card border border-border"
          menuLabel="Order actions"
          leading={[{ key: 'pin', label: 'Pin', icon: <Pin className="h-4 w-4" />, onAction: noop }]}
          trailing={[
            { key: 'archive', label: 'Archive', icon: <Archive className="h-4 w-4" />, onAction: noop },
            { key: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, variant: 'danger', onAction: noop },
          ]}
        >
          <div className="px-4 py-3 text-sm text-textMain">SO-0043 · Nordlicht Media · €980.00</div>
        </SwipeRow>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function PullToRefreshGroup() {
  return (
    <ShowcaseGroup title="PullToRefresh" exports={['PullToRefresh']}>
      <ShowcaseState state="rest · pull down on touch">
        <PullToRefresh
          onRefresh={() => new Promise((resolve) => setTimeout(resolve, 1200))}
          refreshingLabel="Refreshing orders"
          className="h-32 w-80 overflow-auto rounded-card border border-border"
        >
          <ul className="divide-y divide-border text-sm text-textMain">
            <li className="px-4 py-2">SO-0044 · Bergwerk AG</li>
            <li className="px-4 py-2">SO-0043 · Nordlicht Media</li>
            <li className="px-4 py-2">SO-0042 · ACME GmbH</li>
          </ul>
        </PullToRefresh>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

/** Every primitive the kit exports, each in the states the kit renders from props. */
export function GalleryPrimitives() {
  return (
    <>
      <ButtonGroup />
      <IconButtonGroup />
      <InputGroup />
      <TextFieldGroup />
      <SelectGroup />
      <CheckboxGroup />
      <SwitchGroup />
      <SegmentedControlGroup />
      <ChipGroup />
      <BadgeGroup />
      <CardGroup />
      <FabGroup />
      <TooltipGroup />
      <PopoverGroup />
      <LoadingGroup />
      <SwipeRowGroup />
      <PullToRefreshGroup />
    </>
  );
}
