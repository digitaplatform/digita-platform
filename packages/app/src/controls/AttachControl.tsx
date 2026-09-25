import { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { Button } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { uploadFile } from '@/services/upload';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useChrome } from '@/lib/chrome-i18n';
import { safeHttpUrl } from '@/lib/safe-url';

/** File attachment. Read-only → link to the stored file_url. Editable → file picker
 *  that uploads to the entity's storage_path and stores the file_url. */
export default function AttachControl({
  field,
  value,
  entity,
  state,
  onChange,
  controlId,
  labelId,
}: FieldControlProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialog = useDialogHost();
  const tc = useChrome();
  const url = typeof value === 'string' && value ? value : '';
  const fileName = url ? url.split('/').pop() || url : '';
  // Only ever navigate to an http(s)/relative URL — a stored `javascript:`/`data:`
  // value is shown as plain text, never a clickable/executable href (stored XSS).
  const safeUrl = safeHttpUrl(url);

  const remove = async () => {
    const ok = await dialog.confirm({
      title: tc('ui.attach.removeConfirmTitle'),
      message: tc('ui.attach.removeConfirmBody'),
      confirmLabel: tc('ui.attach.remove'),
      danger: true,
    });
    if (ok) onChange(null); // null (not undefined) survives JSON.stringify → engine clears the field + deletes the blob
  };

  if (state.readOnly) {
    if (!url) return <span className="text-sm text-textMuted">—</span>;
    return safeUrl ? (
      <a id={controlId} aria-labelledby={labelId} href={safeUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline">
        {fileName}
      </a>
    ) : (
      <span id={controlId} aria-labelledby={labelId} className="text-sm text-textMuted">{fileName}</span>
    );
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const up = await uploadFile(file, entity, { field: field.fieldname });
      onChange(up.file_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('ui.attach.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {url &&
          (safeUrl ? (
            <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline">
              {fileName}
            </a>
          ) : (
            <span className="text-sm text-textMuted">{fileName}</span>
          ))}
        {/* Hidden native input keeps the id/aria wiring + label(htmlFor) activation;
            the visible kit Button is the keyboard-reachable trigger. */}
        <input
          ref={inputRef}
          id={controlId}
          aria-labelledby={labelId}
          aria-invalid={state.invalid || undefined}
          type="file"
          disabled={uploading}
          onChange={onFile}
          tabIndex={-1}
          className="sr-only"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={uploading}
          disabled={uploading}
          leftIcon={<Upload className="h-4 w-4" aria-hidden="true" />}
          onClick={() => inputRef.current?.click()}
        >
          {tc('ui.attach.choose')}
        </Button>
        {url && !uploading && (
          <button
            type="button"
            aria-label={tc('ui.attach.remove')}
            title={tc('ui.attach.remove')}
            onClick={remove}
            className="text-textMuted transition hover:text-error"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
