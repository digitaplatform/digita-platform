import { useState, type Ref } from 'react';
import { Input } from '@digitaplatform/components';
import type { FieldDefinition } from '@digitaplatform/shared';
import { AddViaLinkSearch } from '@/controls/AddViaLinkSearch';
import { useChrome } from '@/lib/chrome-i18n';

interface LinkEntryInputProps {
  /** The child Link field whose target + search config drive the picker. */
  linkField: FieldDefinition;
  /** Called with the picked row id (and its display text, when known); the
   *  caller appends a line and starts inline entry. */
  onPick: (id: string, display?: string) => void;
  /** Focus handle so the entry flow can return here after a line is committed. */
  inputRef?: Ref<HTMLInputElement>;
  /** Meta-derived test hooks (tid.entry) from the owning TableControl. */
  testId?: Record<string, string | undefined>;
}

/**
 * Persistent link-entry field below the lines grid (line-entry style): type a
 * few characters and press Enter/Tab to open the search dialog (no button); a pick
 * appends a line and the grid starts inline detail entry. The minimum query length
 * is `search_min_chars` (default 1).
 */
export function LinkEntryInput({ linkField, onPick, inputRef, testId }: LinkEntryInputProps) {
  const tc = useChrome();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const minChars = linkField.search_min_chars ?? 1;
  const placeholder = tc('ui.link.searchEntity', { entity: linkField.target ?? '' });

  return (
    <div className="mt-2">
      <Input
        ref={inputRef}
        type="text"
        {...testId}
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter/ArrowDown open the picker; Tab NEVER opens a dialog (it
          // stays the way THROUGH the form). Enter below min_chars is
          // consumed so it can't trigger the form's implicit submit.
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (query.trim().length >= minChars) setOpen(true);
          } else if (e.key === 'ArrowDown' && query.trim().length >= minChars) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      />
      <AddViaLinkSearch
        open={open}
        onClose={() => setOpen(false)}
        linkField={linkField}
        initialQuery={query}
        onPick={(id, display) => {
          onPick(id, display);
          setOpen(false);
          setQuery('');
        }}
      />
    </div>
  );
}
