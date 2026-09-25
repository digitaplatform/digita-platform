import { useState } from 'react';
import { Input } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { describedBy } from '@/controls/control-styles';

/** Free-form string[] tags. Existing tags render as removable chips; a new tag
 *  is added on Enter (trimmed, deduped). Always emits a string[] — or
 *  `undefined` once the array becomes empty. */
export default function TagControl({
  field,
  value,
  state,
  onChange,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const [draft, setDraft] = useState('');
  const tags = Array.isArray(value) ? (value as string[]) : [];

  function commit(next: string[]) {
    onChange(next.length === 0 ? undefined : next);
  }

  function add() {
    const t = draft.trim();
    if (t === '' || tags.includes(t)) {
      setDraft('');
      return;
    }
    commit([...tags, t]);
    setDraft('');
  }

  function remove(tag: string) {
    commit(tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded bg-subtle px-2 py-0.5 text-xs text-textMain"
        >
          {tag}
          {!state.readOnly && (
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => remove(tag)}
              className="text-textMuted"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!state.readOnly && (
        <Input
          id={controlId}
          type="text"
          aria-labelledby={labelId}
          aria-describedby={describedBy(describedById, errorId)}
          aria-required={state.required || undefined}
          aria-invalid={state.invalid || undefined}
          placeholder={field.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
      )}
    </div>
  );
}
