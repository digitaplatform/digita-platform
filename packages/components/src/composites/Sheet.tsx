import { BaseDialog, type BaseDialogProps } from './BaseDialog.js';

/**
 * A bottom sheet — BaseDialog in its `sheet` presentation (drag grabber +
 * slide-up-from-bottom, rounded top). A thin, discoverable wrapper; every other
 * prop is BaseDialog's. Neutral on all designs; the iOS variant gives it the
 * platform slide feel.
 *
 * Detents (P3, opt-in): `detents={['medium','large']}` + `defaultDetent` +
 * `onDetentChange` turn the grabber into a real button — drag it with a snap,
 * click it to cycle, or Arrow Up/Down on it. The panel exposes
 * `data-detent="medium|large"`; only the iOS variant maps those to heights
 * (~50vh/~90vh), so sheets without `detents` — and every other design — are
 * pixel-identical to before.
 */
export function Sheet(props: Omit<BaseDialogProps, 'presentation'>) {
  return <BaseDialog {...props} presentation="sheet" />;
}
