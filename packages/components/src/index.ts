/**
 * @digitaplatform/components — central React component kit on @digitaplatform/theme tokens.
 * The ONE home for the cn() helper + the shared UI primitives. Token-class
 * styling only; consumed by every React frontend and bundled per-plugin.
 */
export { cn } from './lib/cn.js';
export { useFocusTrap } from './lib/use-focus-trap.js';
export { tableSkin } from './lib/table-skin.js';
export { CATEGORICAL_SOFT, CATEGORICAL_OUTLINE } from './lib/categorical.js';
export type { CategoricalColor } from './lib/categorical.js';
export { Button } from './primitives/Button.js';
export { Input } from './primitives/Input.js';
export { Spinner } from './primitives/Spinner.js';
export { Badge } from './primitives/Badge.js';
export type { BadgeProps } from './primitives/Badge.js';
export { Card, CardHeader, CardContent, CardFooter } from './primitives/Card.js';
export { Checkbox } from './primitives/Checkbox.js';
export { Switch } from './primitives/Switch.js';
export type { SwitchProps } from './primitives/Switch.js';
export { SegmentedControl } from './primitives/SegmentedControl.js';
export type { SegmentedControlProps, SegmentedOption } from './primitives/SegmentedControl.js';
export { Fab } from './primitives/Fab.js';
export type { FabProps } from './primitives/Fab.js';
export { Chip } from './primitives/Chip.js';
export type { ChipProps } from './primitives/Chip.js';
export { TextField } from './primitives/TextField.js';
export type { TextFieldProps } from './primitives/TextField.js';
export { Select } from './primitives/Select.js';
export type { SelectOption, SelectProps } from './primitives/Select.js';
export { Tooltip } from './primitives/Tooltip.js';
export { IconButton } from './primitives/IconButton.js';
export { Skeleton } from './primitives/Skeleton.js';
export { Popover } from './primitives/Popover.js';
export type { PopoverProps } from './primitives/Popover.js';
export { SwipeRow } from './primitives/SwipeRow.js';
export type { SwipeRowProps, SwipeAction } from './primitives/SwipeRow.js';
export { PullToRefresh } from './primitives/PullToRefresh.js';
export type { PullToRefreshProps } from './primitives/PullToRefresh.js';
export { Combobox } from './composites/Combobox.js';
export type { ComboboxProps, ComboboxOption } from './composites/Combobox.js';
export { DatePicker } from './composites/DatePicker.js';
export type { DatePickerProps } from './composites/DatePicker.js';
export { ErrorBoundary } from './composites/ErrorBoundary.js';
export { BaseDialog } from './composites/BaseDialog.js';
export type { SheetDetent } from './composites/BaseDialog.js';
export { Sheet } from './composites/Sheet.js';
export { ReportPreviewDialog } from './composites/ReportPreviewDialog.js';
export type { ReportPreviewDialogProps, ReportDownload } from './composites/ReportPreviewDialog.js';
export type { BaseDialogProps } from './composites/BaseDialog.js';
export { SearchDialog } from './composites/SearchDialog.js';
export type { SearchDialogProps, SearchDialogColumn } from './composites/SearchDialog.js';
export { TreeView } from './composites/TreeView.js';
export type { TreeViewProps, TreeViewNode } from './composites/TreeView.js';
export { Menu, MenuItem } from './composites/Menu.js';
export type { MenuProps, MenuItemProps } from './composites/Menu.js';
export { LoadingBlock, ErrorBlock, EmptyState } from './composites/StatusBlocks.js';
export { TableSkeleton, FormSkeleton, CardsSkeleton } from './composites/Skeletons.js';
export { DataGrid } from './composites/DataGrid.js';
export type {
  DataGridProps,
  DataGridColumn,
  DataGridCellKind,
  DataGridAlign,
  DataGridRecomputeTrigger,
  DataGridCellPatch,
  DataGridDisplayArgs,
  DataGridEditArgs,
  DataGridApi,
} from './composites/DataGrid.js';
export { NavList, NavGroup, NavLeafContent, navLeafClass } from './composites/NavRail.js';
export type { NavGroupProps } from './composites/NavRail.js';
export { SplitPane } from './composites/SplitPane.js';
export type { SplitPaneProps } from './composites/SplitPane.js';
export { PageHeader } from './composites/PageHeader.js';
export type { PageHeaderProps, PageHeaderBackAction } from './composites/PageHeader.js';
export { TabBar } from './composites/TabBar.js';
export type { TabBarProps, TabBarItem } from './composites/TabBar.js';
export { NavigationBar } from './composites/NavigationBar.js';
export type { NavigationBarProps, NavigationBarItem } from './composites/NavigationBar.js';
export { ToastHost, useToast } from './composites/Toast.js';
export type { ToastHostProps, ToastApi, ToastOptions, ToastAction, ToastType } from './composites/Toast.js';
export { CommandPalette } from './composites/CommandPalette.js';
export type { CommandPaletteProps, CommandPaletteItem } from './composites/CommandPalette.js';
export { Watermark } from './composites/Watermark.js';
export type { WatermarkProps, WatermarkTone, WatermarkDensity } from './composites/Watermark.js';
