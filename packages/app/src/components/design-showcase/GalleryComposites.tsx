import { useId, useState } from 'react';
import {
  Bell,
  Check,
  FileText,
  Globe,
  Home,
  Inbox,
  Monitor,
  Moon,
  Package,
  Pencil,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  X,
} from 'lucide-react';
import {
  Badge,
  BaseDialog,
  BrandMark,
  Button,
  CardList,
  CardsSkeleton,
  Combobox,
  CommandPalette,
  DataGrid,
  DatePicker,
  Drawer,
  EmptyState,
  ErrorBlock,
  ErrorBoundary,
  FormRow,
  FormSection,
  FormSkeleton,
  IconButton,
  Input,
  LanguageMenu,
  LoadingBlock,
  Menu,
  MenuItem,
  ModeButton,
  NavGroup,
  NavLeafContent,
  NavList,
  NavigationBar,
  PageHeader,
  ProductLockup,
  ReportPreviewDialog,
  SearchDialog,
  Sheet,
  SignatureBackdrop,
  SplitPane,
  TabBar,
  TabPanel,
  Tabs,
  TableSkeleton,
  ToastHost,
  TopBar,
  TreeView,
  TreeEditor,
  Watermark,
  navLeafClass,
  railButtonClass,
  topBarButtonClass,
  useToast,
  type DataGridColumn,
} from '@digitaplatform/components';
import { getSignature } from '@digitaplatform/theme';
import { isModeLocked, useThemeStore } from '@/stores/theme';
import { ShowcaseGroup, ShowcaseOpener, ShowcaseState, ShowcaseViewport } from './ShowcaseGroup';

const noop = () => {};

interface Customer {
  id: string;
  name: string;
  city: string;
  openOrders: number;
}

const CUSTOMERS: Customer[] = [
  { id: 'C-1001', name: 'ACME GmbH', city: 'Berlin', openOrders: 3 },
  { id: 'C-1002', name: 'Bergwerk AG', city: 'Zurich', openOrders: 1 },
  { id: 'C-1003', name: 'Helvetia Sports', city: 'Bern', openOrders: 0 },
  { id: 'C-1004', name: 'Nordlicht Media', city: 'Hamburg', openOrders: 2 },
  { id: 'C-1005', name: 'Aurora Retail', city: 'Vienna', openOrders: 4 },
];

type Line = { id: string; item: string; quantity: number; price: string; amount: string };

const LINES: Line[] = [
  { id: 'l1', item: 'Trail runner, size 42', quantity: 12, price: '€89.90', amount: '€1,078.80' },
  { id: 'l2', item: 'Rain shell, navy', quantity: 6, price: '€119.00', amount: '€714.00' },
  { id: 'l3', item: 'Merino socks, 3 pack', quantity: 5, price: '€18.67', amount: '€93.35' },
];

const LINE_COLUMNS: DataGridColumn[] = [
  { key: 'item', label: 'Item', kind: 'text', editable: true, required: true },
  { key: 'quantity', label: 'Quantity', kind: 'number', editable: true, align: 'end', stepper: { min: 1 } },
  { key: 'price', label: 'Price', kind: 'currency', align: 'end' },
  { key: 'amount', label: 'Amount', kind: 'currency', align: 'end' },
];

const WIDE_COLUMNS: DataGridColumn[] = [
  { key: 'item', label: 'Item', kind: 'text' },
  { key: 'quantity', label: 'Quantity', kind: 'number', align: 'end' },
  { key: 'price', label: 'Price', kind: 'currency', align: 'end' },
  { key: 'amount', label: 'Amount', kind: 'currency', align: 'end' },
  { key: 'warehouse', label: 'Warehouse', kind: 'text' },
  { key: 'delivery', label: 'Delivery date', kind: 'date' },
];

const PRODUCT_GROUPS = [
  { id: 'all', label: 'All products', parentId: null },
  { id: 'footwear', label: 'Footwear', parentId: 'all', subtitle: '48 products' },
  { id: 'trail', label: 'Trail', parentId: 'footwear' },
  { id: 'road', label: 'Road', parentId: 'footwear' },
  { id: 'apparel', label: 'Apparel', parentId: 'all', subtitle: '112 products' },
  { id: 'retired', label: 'Retired lines', parentId: 'all' },
];

const TREE_EDITOR_LABELS = {
  kind: 'Kind',
  newKind: 'New kind',
  kindName: 'Name of the new kind',
  create: 'Create',
  addRoot: 'Top level',
  addChild: 'Add child',
  move: 'Move',
  moveToRoot: 'To top level',
  movingHint: 'Choose the new parent…',
  cancel: 'Cancel',
  delete: 'Delete',
  search: 'Search',
  noResults: 'No results',
  select: 'Select',
};

const PRODUCT_GROUP_KINDS = [
  ...PRODUCT_GROUPS.map((n) => ({ ...n, kind: 'Products' })),
  { id: 'north', label: 'North', parentId: null, kind: 'Regions' },
];

const asyncNoop = async () => {};

const NAV_ITEMS = [
  { key: 'home', label: 'Home', icon: <Home className="h-6 w-6" /> },
  { key: 'orders', label: 'Orders', icon: <ShoppingCart className="h-6 w-6" /> },
  { key: 'customers', label: 'Customers', icon: <Users className="h-6 w-6" /> },
  { key: 'deliveries', label: 'Deliveries', icon: <Truck className="h-6 w-6" /> },
  { key: 'invoices', label: 'Invoices', icon: <Receipt className="h-6 w-6" /> },
  { key: 'products', label: 'Products', icon: <Package className="h-6 w-6" /> },
].map((item) => ({ ...item, onSelect: noop }));

const PALETTE_ITEMS = [
  { id: 'confirm', group: 'Actions', label: 'Confirm SO-0042', icon: <Check className="h-4 w-4" />, shortcut: '↵' },
  { id: 'edit', group: 'Actions', label: 'Edit confirmation text', icon: <Pencil className="h-4 w-4" /> },
  { id: 'cancel', group: 'Actions', label: 'Cancel SO-0042', sublabel: 'Needs the Sales Manager role', disabled: true },
  { id: 'confirmed', group: 'Records', label: 'Confirmed orders', sublabel: '12 records', icon: <FileText className="h-4 w-4" /> },
];

function ComboboxGroup() {
  const [value, setValue] = useState('ACME GmbH');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const options = CUSTOMERS.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).map((c) => ({
    id: c.id,
    label: c.name,
    subtitle: c.city,
  }));
  return (
    <ShowcaseGroup title="Combobox" exports={['Combobox']}>
      <ShowcaseState state="rest · typing opens">
        <Combobox
          className="w-64"
          ariaLabel="Customer"
          value={value}
          query={query}
          onQueryChange={setQuery}
          options={options}
          open={open}
          onOpenChange={setOpen}
          onPick={(o) => {
            setValue(o.label);
            setOpen(false);
          }}
          onClear={() => setValue('')}
          clearLabel="Clear customer"
        />
      </ShowcaseState>
      <ShowcaseState state="invalid">
        <Combobox
          className="w-64"
          ariaLabel="Customer"
          value=""
          query=""
          onQueryChange={noop}
          options={[]}
          open={false}
          onOpenChange={noop}
          onPick={noop}
          invalid
          required
          placeholder="Required"
        />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function DatePickerGroup() {
  const [date, setDate] = useState<string | undefined>('2026-09-28');
  // Each picker is named by a visible label, as a record form names it, so the states read apart.
  const labelId = useId();
  const label = (n: number, text: string) => (
    <span id={`${labelId}-${n}`} className="text-xs font-medium text-textMuted">
      {text}
    </span>
  );
  return (
    <ShowcaseGroup title="DatePicker" exports={['DatePicker']}>
      <ShowcaseState state="selected · click opens">
        <div className="flex w-56 flex-col gap-1.5">
          {label(1, 'Order date')}
          <DatePicker value={date} onChange={setDate} locale="en-GB" aria-labelledby={`${labelId}-1`} />
        </div>
      </ShowcaseState>
      <ShowcaseState state="rest · placeholder">
        <div className="flex w-56 flex-col gap-1.5">
          {label(2, 'Delivery date')}
          <DatePicker onChange={noop} placeholder="Delivery date" aria-labelledby={`${labelId}-2`} />
        </div>
      </ShowcaseState>
      <ShowcaseState state="invalid">
        <div className="flex w-56 flex-col gap-1.5">
          {label(3, 'Due date')}
          <DatePicker onChange={noop} invalid placeholder="Required" aria-labelledby={`${labelId}-3`} />
        </div>
      </ShowcaseState>
      <ShowcaseState state="disabled">
        <div className="flex w-56 flex-col gap-1.5">
          {label(4, 'Posting date')}
          <DatePicker value="2026-09-28" onChange={noop} disabled locale="en-GB" aria-labelledby={`${labelId}-4`} />
        </div>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function OverlayGroup() {
  const [open, setOpen] = useState<'dialog' | 'sheet' | 'drawer' | 'report' | 'search' | 'palette' | null>(null);
  const [query, setQuery] = useState('');
  const toggle = (which: NonNullable<typeof open>) => setOpen((o) => (o === which ? null : which));
  const close = () => setOpen(null);
  const footer = (
    <>
      <Button variant="secondary" onClick={close}>
        Not yet
      </Button>
      <Button onClick={close}>Submit</Button>
    </>
  );
  return (
    <>
      <ShowcaseGroup title="BaseDialog" exports={['BaseDialog']}>
        <ShowcaseState state="open · centered">
          <ShowcaseOpener open={open === 'dialog'} onToggle={() => toggle('dialog')}>
            Open dialog
          </ShowcaseOpener>
        </ShowcaseState>
        <BaseDialog open={open === 'dialog'} onClose={close} title="Submit SO-0042?" footer={footer}>
          <p>
            Submitting freezes the customer and the prices on this order and books it into the open period.
          </p>
        </BaseDialog>
      </ShowcaseGroup>
      <ShowcaseGroup title="Sheet" exports={['Sheet']}>
        <ShowcaseState state="open · detents medium and large">
          <ShowcaseOpener open={open === 'sheet'} onToggle={() => toggle('sheet')}>
            Open sheet
          </ShowcaseOpener>
        </ShowcaseState>
        <Sheet open={open === 'sheet'} onClose={close} title="Delivery for SO-0042" detents={['medium', 'large']} footer={footer}>
          <p className="text-sm text-textMain">Two parcels leave Basel on 30 Sep 2026.</p>
        </Sheet>
      </ShowcaseGroup>
      <ShowcaseGroup title="Drawer" exports={['Drawer']}>
        <ShowcaseState state="open · left">
          <ShowcaseOpener open={open === 'drawer'} onToggle={() => toggle('drawer')}>
            Open drawer
          </ShowcaseOpener>
        </ShowcaseState>
        <Drawer open={open === 'drawer'} onClose={close} label="Navigation">
          <nav className="flex h-full w-72 flex-col gap-1 bg-surface p-4 text-sm text-textMain">
            <button type="button" className={navLeafClass(true)} onClick={close}>
              Orders
            </button>
            <button type="button" className={navLeafClass(false)} onClick={close}>
              Customers
            </button>
          </nav>
        </Drawer>
      </ShowcaseGroup>
      <ShowcaseGroup title="ReportPreviewDialog" exports={['ReportPreviewDialog']}>
        <ShowcaseState state="open">
          <ShowcaseOpener open={open === 'report'} onToggle={() => toggle('report')}>
            Open report preview
          </ShowcaseOpener>
        </ShowcaseState>
        <ReportPreviewDialog
          open={open === 'report'}
          onClose={close}
          title="Order confirmation SO-0042"
          src="about:blank"
          downloads={[{ label: 'PDF', href: 'about:blank' }]}
        />
      </ShowcaseGroup>
      <ShowcaseGroup title="SearchDialog" exports={['SearchDialog']}>
        <ShowcaseState state="open">
          <ShowcaseOpener open={open === 'search'} onToggle={() => toggle('search')}>
            Open search dialog
          </ShowcaseOpener>
        </ShowcaseState>
        <SearchDialog<Customer>
          open={open === 'search'}
          onClose={close}
          title="Choose a customer"
          query={query}
          onQueryChange={setQuery}
          columns={[
            { key: 'name', label: 'Customer' },
            { key: 'city', label: 'City' },
            { key: 'openOrders', label: 'Open orders', align: 'right' },
          ]}
          rows={CUSTOMERS.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))}
          getRowId={(c) => c.id}
          onPick={close}
          searchPlaceholder="Search customers"
        />
      </ShowcaseGroup>
      <ShowcaseGroup title="CommandPalette" exports={['CommandPalette']}>
        <ShowcaseState state="open · active, disabled and grouped rows, a status row">
          <ShowcaseOpener open={open === 'palette'} onToggle={() => toggle('palette')}>
            Open command palette
          </ShowcaseOpener>
        </ShowcaseState>
        <CommandPalette
          open={open === 'palette'}
          onClose={close}
          items={PALETTE_ITEMS}
          onSelect={close}
          status="Searching records…"
        />
      </ShowcaseGroup>
    </>
  );
}

function MenuGroup() {
  const [status, setStatus] = useState('confirmed');
  const [language, setLanguage] = useState('en');
  const mode = useThemeStore((s) => s.mode);
  const cycleMode = useThemeStore((s) => s.cycleMode);
  // Under the tenant's light/dark lock the mode does not change, so the showcase offers no ModeButton.
  const modeLocked = useThemeStore((s) => isModeLocked(s.branding));
  return (
    <>
      <ShowcaseGroup title="Menu, MenuItem" exports={['Menu', 'MenuItem']}>
        <ShowcaseState state="rest · click opens: icon, checked, danger, disabled items">
          <Menu label="Order actions" trigger={<span className="px-2 text-sm">Actions</span>} panelClassName="w-60">
            {(close) => (
              <>
                <MenuItem icon={<Pencil className="h-4 w-4" />} onSelect={close}>
                  Edit
                </MenuItem>
                {['draft', 'confirmed'].map((s) => (
                  <MenuItem key={s} checked={status === s} onSelect={() => { setStatus(s); close(); }}>
                    {s}
                  </MenuItem>
                ))}
                <MenuItem danger icon={<X className="h-4 w-4" />} onSelect={close}>
                  Cancel order
                </MenuItem>
                <MenuItem disabled onSelect={close}>
                  Amend (submitted orders only)
                </MenuItem>
              </>
            )}
          </Menu>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="LanguageMenu" exports={['LanguageMenu']}>
        <ShowcaseState state="rest · click opens">
          <LanguageMenu
            label="Language"
            current={language}
            languages={[
              { code: 'en', label: 'English' },
              { code: 'de', label: 'Deutsch' },
              { code: 'fr', label: 'Français' },
            ]}
            onSelect={setLanguage}
            icon={<Globe className="h-5 w-5" />}
          />
        </ShowcaseState>
      </ShowcaseGroup>
      {!modeLocked && (
        <ShowcaseGroup title="ModeButton" exports={['ModeButton']}>
          <ShowcaseState state={`${mode} · cycles the page's mode`}>
            <ModeButton
              mode={mode}
              onCycle={cycleMode}
              label="Mode"
              icons={{ light: <Sun className="h-5 w-5" />, dark: <Moon className="h-5 w-5" />, system: <Monitor className="h-5 w-5" /> }}
            />
          </ShowcaseState>
        </ShowcaseGroup>
      )}
    </>
  );
}

function FeedbackGroup() {
  return (
    <>
      <ShowcaseGroup title="LoadingBlock, ErrorBlock, EmptyState" exports={['LoadingBlock', 'ErrorBlock', 'EmptyState']}>
        <ShowcaseState state="LoadingBlock">
          <LoadingBlock label="Loading orders…" className="w-64" />
        </ShowcaseState>
        <ShowcaseState state="ErrorBlock">
          <div className="w-72">
            <ErrorBlock title="The order could not be saved" detail="The customer's credit limit is exceeded by €240.00." />
          </div>
        </ShowcaseState>
        <ShowcaseState state="EmptyState">
          <div className="w-72">
            <EmptyState
              title="No deliveries yet"
              hint="A delivery appears here once the order is picked."
              icon={<Inbox aria-hidden="true" />}
              action={<Button size="sm">New delivery</Button>}
            />
          </div>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="TableSkeleton, FormSkeleton, CardsSkeleton" exports={['TableSkeleton', 'FormSkeleton', 'CardsSkeleton']}>
        <ShowcaseState state="TableSkeleton">
          <TableSkeleton columns={4} rows={3} className="w-80" />
        </ShowcaseState>
        <ShowcaseState state="FormSkeleton">
          <FormSkeleton fields={4} className="w-80" />
        </ShowcaseState>
        <ShowcaseState state="CardsSkeleton">
          <CardsSkeleton cards={2} className="w-80" />
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="ErrorBoundary" exports={['ErrorBoundary']}>
        <ShowcaseState state="rest · children render">
          <ErrorBoundary fallback={(error) => <ErrorBlock title={error.message} />}>
            <p className="text-sm text-textMain">The order form rendered without an error.</p>
          </ErrorBoundary>
        </ShowcaseState>
      </ShowcaseGroup>
    </>
  );
}

function ToastButtons() {
  const { toast } = useToast();
  return (
    <>
      <ShowcaseState state="success">
        <ShowcaseOpener onToggle={() => toast('SO-0042 saved', 'success')}>Show success</ShowcaseOpener>
      </ShowcaseState>
      <ShowcaseState state="error · with action">
        <ShowcaseOpener
          onToggle={() =>
            toast('SO-0042 could not be submitted', { type: 'error', duration: 0, action: { label: 'Retry', onClick: noop } })
          }
        >
          Show error
        </ShowcaseOpener>
      </ShowcaseState>
      <ShowcaseState state="warning · info">
        <ShowcaseOpener
          onToggle={() => {
            toast('Credit limit almost reached', 'warning');
            toast('Two orders were updated by another user', 'info');
          }}
        >
          Show warning and info
        </ShowcaseOpener>
      </ShowcaseState>
    </>
  );
}

function DataGridGroup() {
  const [rows, setRows] = useState(LINES);
  return (
    <ShowcaseGroup title="DataGrid" exports={['DataGrid']}>
      <ShowcaseState state="editable · click a cell selects, typing edits">
        <DataGrid<Line>
          className="w-[36rem]"
          aria-label="Order lines"
          rows={rows}
          columns={LINE_COLUMNS}
          getRowId={(r) => r.id}
          canAddRow
          canRemoveRow
          onAddRow={noop}
          onRemoveRow={(id) => setRows((rs) => rs.filter((r) => r.id !== id))}
          onCellChange={({ rowId, fieldname, value }) =>
            setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, [fieldname]: value } : r)))
          }
          renderEditor={({ value, onChange, done, cancel }) => (
            <Input
              autoFocus
              value={value == null ? '' : String(value)}
              onChange={(e) => onChange(e.target.value)}
              onBlur={done}
              onKeyDown={(e) => {
                if (e.key === 'Enter') done();
                if (e.key === 'Escape') cancel();
              }}
            />
          )}
          footer={{ item: 'Total', amount: '€1,886.15' }}
          addRowLabel="Add line"
          removeRowLabel="Remove line"
        />
      </ShowcaseState>
      <ShowcaseState state="narrow · columns collapse to a chip">
        <DataGrid<Line & { warehouse: string; delivery: string }>
          className="w-72"
          aria-label="Order lines, narrow"
          editable={false}
          rows={LINES.map((l) => ({ ...l, warehouse: 'Basel', delivery: '2026-09-30' }))}
          columns={WIDE_COLUMNS}
          getRowId={(r) => r.id}
        />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function CardListGroup() {
  return (
    <ShowcaseGroup title="CardList" exports={['CardList']}>
      <ShowcaseState state="phone rows · the current record marked">
        <CardList<Line>
          className="w-72"
          aria-label="Order lines"
          rows={LINES}
          getRowId={(r) => r.id}
          selectedRowId="l2"
          onRowClick={noop}
          renderCard={(r) => (
            <>
              <span className="font-medium text-primaryText">{r.item}</span>
              <span className="mt-1 block text-xs text-textMuted">
                {r.quantity} × {r.price} · {r.amount}
              </span>
            </>
          )}
        />
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function NavigationGroup() {
  const [open, setOpen] = useState(true);
  const [collapsedOpen, setCollapsedOpen] = useState(false);
  const leaf = (label: string, active: boolean) => (
    <li>
      <a href="#design" className={navLeafClass(active)} onClick={(e) => e.preventDefault()}>
        <NavLeafContent icon={<FileText />} trailing={active ? <span className="text-xs text-textMuted">42</span> : undefined}>
          {label}
        </NavLeafContent>
      </a>
    </li>
  );
  return (
    <>
      <ShowcaseGroup title="NavList, NavGroup, NavLeafContent" exports={['NavList', 'NavGroup', 'NavLeafContent']}>
        <ShowcaseState state="open group · active and rest leaves · closed group">
          <nav className="w-64">
            <NavList>
              <NavGroup label="Sales" icon={<ShoppingCart />} open={open} onToggle={() => setOpen((o) => !o)}>
                <NavList sub>
                  {leaf('Quotations', false)}
                  {leaf('Orders', true)}
                  {leaf('Deliveries', false)}
                </NavList>
              </NavGroup>
              <NavGroup label="Master data" icon={<Settings />} open={collapsedOpen} onToggle={() => setCollapsedOpen((o) => !o)}>
                <NavList sub>{leaf('Customers', false)}</NavList>
              </NavGroup>
            </NavList>
          </nav>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="TreeView" exports={['TreeView']}>
        <ShowcaseState state="selected · disabled node · expanded">
          <div className="w-64">
            <TreeView nodes={PRODUCT_GROUPS} selectedId="trail" onSelect={noop} disabledIds={new Set(['retired'])} />
          </div>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="TreeEditor" exports={['TreeEditor']}>
        <ShowcaseState state="kinds · add, move and delete per node">
          <div className="w-96">
            <TreeEditor
              nodes={PRODUCT_GROUP_KINDS}
              hasKinds
              canCreate
              canMove={() => true}
              canDelete={(node) => node.id !== 'all'}
              labels={TREE_EDITOR_LABELS}
              onAdd={noop}
              onEdit={noop}
              onMove={asyncNoop}
              onDelete={asyncNoop}
            />
          </div>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="TabBar" exports={['TabBar']}>
        <ShowcaseState state="active tab · four targets">
          <ShowcaseViewport>
            <TabBar aria-label="Sections" items={NAV_ITEMS.slice(0, 4)} activeKey="orders" />
          </ShowcaseViewport>
        </ShowcaseState>
        <ShowcaseState state="six targets collapse into More">
          <ShowcaseViewport>
            <TabBar aria-label="Sections" items={NAV_ITEMS} activeKey="products" onMore={noop} />
          </ShowcaseViewport>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="NavigationBar" exports={['NavigationBar']}>
        <ShowcaseState state="active target · four targets">
          <ShowcaseViewport>
            <NavigationBar aria-label="Sections" items={NAV_ITEMS.slice(0, 4)} activeKey="orders" />
          </ShowcaseViewport>
        </ShowcaseState>
        <ShowcaseState state="six targets collapse into More">
          <ShowcaseViewport>
            <NavigationBar aria-label="Sections" items={NAV_ITEMS} activeKey="products" onMore={noop} />
          </ShowcaseViewport>
        </ShowcaseState>
      </ShowcaseGroup>
    </>
  );
}

function RecordFormGroup() {
  const [tab, setTab] = useState('lines');
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ShowcaseGroup title="Record form" exports={['Tabs', 'TabPanel', 'FormSection', 'FormRow']}>
      <ShowcaseState state="tabs with an error count · collapsible section · required, invalid and read-only rows">
        <div className="w-full max-w-xl space-y-4">
          <Tabs
            id="showcase-record"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'lines', label: 'Lines' },
              { key: 'payments', label: 'Payments', badge: <Badge variant="pill" size="sm" color="error">1</Badge> },
              { key: 'history', label: 'History' },
            ]}
          />
          <TabPanel tabsId="showcase-record" tabKey={tab} className="space-y-4">
            <FormSection title="Order" collapsible collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)}>
              <div className="grid gap-6 sm:grid-cols-2">
                <FormRow controlId="showcase-record-customer" label="Customer" required>
                  <Input id="showcase-record-customer" defaultValue="ACME GmbH" />
                </FormRow>
                <FormRow
                  controlId="showcase-record-po"
                  label="Customer PO"
                  required
                  error="A confirmed order needs the customer's PO number."
                  errorId="showcase-record-po-error"
                >
                  <Input id="showcase-record-po" aria-invalid aria-describedby="showcase-record-po-error" placeholder="Required" />
                </FormRow>
                <FormRow controlId="showcase-record-total" label="Grand total">
                  <Input id="showcase-record-total" framed readOnly value="€1,886.15" />
                </FormRow>
              </div>
            </FormSection>
          </TabPanel>
        </div>
      </ShowcaseState>
    </ShowcaseGroup>
  );
}

function LayoutGroup() {
  const back = { label: 'Orders', onClick: noop };
  const actions = <IconButton label="More actions" icon={<Settings className="h-4 w-4" />} />;
  return (
    <>
      <ShowcaseGroup title="PageHeader" exports={['PageHeader']}>
        <ShowcaseState state="expanded · back, actions, search">
          <PageHeader
            className="w-96"
            headingLevel={3}
            title="SO-0042"
            collapsed={false}
            back={back}
            actions={actions}
            search={<Input placeholder="Search lines" />}
          />
        </ShowcaseState>
        <ShowcaseState state="expanded · media, eyebrow and status">
          <PageHeader
            className="w-96"
            headingLevel={3}
            media={<span aria-hidden="true" className="block h-16 w-16 rounded border border-border bg-subtle" />}
            eyebrow="Sales Order"
            title="SO-0042"
            status={<Badge variant="pill" size="lg" color="success">confirmed</Badge>}
            collapsed={false}
          />
        </ShowcaseState>
        <ShowcaseState state="collapsed">
          <PageHeader className="w-96" headingLevel={3} title="SO-0042" collapsed back={back} actions={actions} />
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="TopBar" exports={['TopBar']}>
        <ShowcaseState state="rest · top bar and rail buttons">
          <TopBar className="w-96">
            <span className="text-sm text-textMain">Sales / Orders</span>
            <span className="flex items-center gap-1">
              <button type="button" className={topBarButtonClass} aria-label="Search">
                <Search className="h-5 w-5" />
              </button>
              <button type="button" className={railButtonClass} aria-label="Notifications">
                <Bell className="h-5 w-5" />
              </button>
            </span>
          </TopBar>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="SplitPane" exports={['SplitPane']}>
        <ShowcaseState state="rest · drag or arrow keys resize">
          <div className="h-40 w-[32rem] rounded-card border border-border">
            <SplitPane
              aria-label="Resize the order list"
              defaultSize={200}
              min={140}
              max={320}
              first={<div className="p-3 text-sm text-textMain">SO-0044 · SO-0043 · SO-0042</div>}
              second={<div className="p-3 text-sm text-textMain">SO-0042 · ACME GmbH · €1,886.15</div>}
            />
          </div>
        </ShowcaseState>
      </ShowcaseGroup>
    </>
  );
}

function BrandGroup() {
  const signature = getSignature(useThemeStore((s) => s.signature));
  return (
    <>
      <ShowcaseGroup title="BrandMark" exports={['BrandMark']}>
        <ShowcaseState state="signature wordmark">
          <BrandMark name="Digita" signature={signature} />
        </ShowcaseState>
        <ShowcaseState state="tenant name">
          <BrandMark name="Helvetia Sports" nameIsCustom signature={signature} />
        </ShowcaseState>
        <ShowcaseState state="fill · rail">
          <div className="w-56">
            <BrandMark name="Digita" signature={signature} fill />
          </div>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="ProductLockup" exports={['ProductLockup']}>
        <ShowcaseState state="rest">
          <ProductLockup family={signature.family ?? 'digita'} product="erp" className="text-2xl" />
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="SignatureBackdrop" exports={['SignatureBackdrop']}>
        <ShowcaseState state={signature.graphics ? 'the active signature’s grid and glow' : 'the active signature has no graphics'}>
          <div className="relative isolate h-32 w-80 overflow-hidden rounded-card border border-border">
            <SignatureBackdrop graphics={signature.graphics} />
          </div>
        </ShowcaseState>
      </ShowcaseGroup>
      <ShowcaseGroup title="Watermark" exports={['Watermark']}>
        {(['warning', 'error', 'info', 'neutral'] as const).map((tone) => (
          <ShowcaseState key={tone} state={tone}>
            <div className="relative h-24 w-48 overflow-hidden rounded-card border border-border">
              <Watermark label="Sample data" tone={tone} density={tone === 'neutral' ? 'dense' : 'normal'} />
            </div>
          </ShowcaseState>
        ))}
      </ShowcaseGroup>
    </>
  );
}

/** Every composite the kit exports, each in the states the kit renders from props. */
export function GalleryComposites() {
  return (
    <>
      <ComboboxGroup />
      <DatePickerGroup />
      <OverlayGroup />
      <MenuGroup />
      <ToastHost closeLabel="Dismiss">
        <ShowcaseGroup title="ToastHost, useToast" exports={['ToastHost']}>
          <ToastButtons />
        </ShowcaseGroup>
      </ToastHost>
      <DataGridGroup />
      <CardListGroup />
      <NavigationGroup />
      <RecordFormGroup />
      <LayoutGroup />
      <FeedbackGroup />
      <BrandGroup />
    </>
  );
}
