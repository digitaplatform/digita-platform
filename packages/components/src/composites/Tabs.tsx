import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * In-page tabs over one panel: a `tablist` strip whose buttons switch the content
 * below, unlike `TabBar`, which switches top-level pages. Every tab is a tab stop and
 * a click, Enter or Space activates it. The strip paints its own surface, so a page
 * can pin it (`sticky`) over the content it scrolls past.
 *
 * `Tabs` and `TabPanel` derive the ids that pair a tab with its panel from the same
 * `tabsId`, so a form keeps no id arithmetic of its own.
 */

export interface TabsItem {
  key: string;
  label: ReactNode;
  /** A marker after the label, e.g. the count of errors on the tab's panel. */
  badge?: ReactNode;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'id'> {
  items: TabsItem[];
  /** Key of the selected tab. */
  value: string;
  onChange: (key: string) => void;
  /** The strip's id; each tab's id and its panel's id derive from it. */
  id: string;
}

const tabId = (tabsId: string, key: string) => `${tabsId}-tab-${key}`;
const panelId = (tabsId: string, key: string) => `${tabsId}-panel-${key}`;

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { items, value, onChange, id, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      {...props}
      id={id}
      data-ui="tabs"
      role="tablist"
      aria-orientation="horizontal"
      className={cn('flex gap-1 overflow-x-auto border-b border-border bg-surface [scrollbar-width:none]', className)}
    >
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            data-ui="tab"
            role="tab"
            id={tabId(id, item.key)}
            aria-selected={selected}
            aria-controls={panelId(id, item.key)}
            onClick={() => onChange(item.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus',
              // An unselected tab whose badge reports an error reads as the error, not as muted.
              selected
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-textMuted hover:text-textMain [&:has([data-color=error])]:text-error [&:has([data-color=error])]:hover:text-error',
            )}
          >
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
});

export interface TabPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'id'> {
  /** The `id` of the `Tabs` strip this panel belongs to. */
  tabsId: string;
  /** Key of the tab that controls this panel. */
  tabKey: string;
}

export const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
  { tabsId, tabKey, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      {...props}
      data-ui="tab-panel"
      role="tabpanel"
      id={panelId(tabsId, tabKey)}
      aria-labelledby={tabId(tabsId, tabKey)}
    />
  );
});
