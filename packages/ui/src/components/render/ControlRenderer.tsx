import { Suspense } from 'react';
import type { FieldControlProps } from '@/controls/types';
import { resolveControl } from './control-registry';
import { Skeleton } from '@digitaplatform/components';
import { UnsupportedControl } from './UnsupportedControl';

/**
 * Resolve the field type to a control Unit and render it. Each control gets its
 * OWN Suspense boundary so one slow lazy chunk never blanks the whole form. An
 * unmapped/layout type routes to the loud UnsupportedControl.
 */
export function ControlRenderer(props: FieldControlProps) {
  const res = resolveControl(props.field.fieldtype);
  if (res.kind === 'unsupported') {
    return <UnsupportedControl fieldtype={res.fieldtype} reason={res.reason} field={props.field} />;
  }
  const { Component } = res;
  return (
    <Suspense fallback={<Skeleton className="h-9 w-full" />}>
      <Component {...props} />
    </Suspense>
  );
}
