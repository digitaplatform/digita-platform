import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Card } from '../primitives/Card.js';

/**
 * One section of a record form: a `section` with an optional title on a flat kit `Card`.
 * The Card is the block a design already sizes its body copy on (`card`), so a form
 * section reads like every other content block; the section and the title carry
 * `form-section` and `form-section-title`. A collapsible section puts the title in a
 * disclosure button that carries `aria-expanded`; the section hides its fields while
 * collapsed, so a design such as ios can group the rows inside it.
 */

export interface FormSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  collapsible?: boolean;
  /** Only read while `collapsible`. */
  collapsed?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-base ease-smooth', collapsed && '-rotate-90')}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export const FormSection = forwardRef<HTMLDivElement, FormSectionProps>(function FormSection(
  { title, collapsible = false, collapsed = false, onToggle, className, children, ...props },
  ref,
) {
  const hidden = collapsible && collapsed;
  return (
    <Card ref={ref} {...props} className={className}>
      <section data-ui="form-section" className="space-y-5">
        {title != null && (
          <header className="border-b border-border pb-3">
            <h3 data-ui="form-section-title" className="text-sm font-semibold text-textMain">
              {collapsible ? (
                <button
                  type="button"
                  onClick={onToggle}
                  aria-expanded={!collapsed}
                  className="flex w-full items-center gap-2 text-left transition-colors duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <span>{title}</span>
                  <ChevronIcon collapsed={collapsed} />
                </button>
              ) : (
                title
              )}
            </h3>
          </header>
        )}
        {!hidden && children}
      </section>
    </Card>
  );
});
