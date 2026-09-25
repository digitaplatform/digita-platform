import { LoadingBlock as KitLoadingBlock, ErrorBlock as KitErrorBlock } from '@digitaplatform/components';
import type { UiMessage } from '@/lib/api-result';
import { useChrome } from '@/lib/chrome-i18n';

/** Status blocks for the List + Record pages. The generic markup lives in
 *  @digitaplatform/components; these thin wrappers inject the app's localized defaults so
 *  every call site stays unchanged. EmptyState needs no defaults → pure re-export. */

export { EmptyState } from '@digitaplatform/components';

export function LoadingBlock({ label }: { label?: string }) {
  const tc = useChrome();
  return <KitLoadingBlock label={label ?? tc('ui.status.loading')} />;
}

export function ErrorBlock({ title, detail }: { title?: string; detail?: string }) {
  const tc = useChrome();
  return <KitErrorBlock title={title ?? tc('ui.status.somethingWrong')} detail={detail} />;
}

/** Focusable form-level error list — server errors land here (Phase 1 has no
 *  reliable per-field server binding; see the engine follow-up). App-specific
 *  (consumes the UiMessage shape), so it stays here. */
export function FormErrorSummary({ messages }: { messages: UiMessage[] }) {
  const errs = messages.filter((m) => m.type === 'error');
  if (errs.length === 0) return null;
  return (
    <div
      role="alert"
      tabIndex={-1}
      className="rounded-md border border-error bg-error-light p-3 text-sm text-error"
    >
      <ul className="list-disc space-y-0.5 pl-5">
        {errs.map((m, i) => (
          <li key={i}>{m.text}</li>
        ))}
      </ul>
    </div>
  );
}
