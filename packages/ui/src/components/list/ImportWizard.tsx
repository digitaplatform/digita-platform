import { useMemo, useRef, useState } from 'react';
import type { EntityDefinition, ImportMode, ImportReport } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES } from '@digitaplatform/shared';
import { Button, BaseDialog, SegmentedControl } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { parseCsv } from '@/lib/csv';
import { importRows } from '@/services/importExport';

const SYSTEM_COLS = new Set(['_id', 'doctype', 'docstatus', 'owner', 'modified_by', 'creation', 'modified']);

export interface ImportWizardProps {
  entity: string;
  meta: EntityDefinition;
  open: boolean;
  onClose: () => void;
  /** Called after a successful (non-dry-run) import so the caller can refetch. */
  onImported: () => void;
}

/**
 * Generic, metadata-driven CSV import dialog — zero per-entity code. The user
 * picks a file (or pastes CSV) and a mode, sees which columns the meta recognizes,
 * runs a server-side dry run (mode=validate, no writes) to preview every problem,
 * then commits. All parsing/typing/business-key resolution is authoritative on
 * the server; the client only previews the header for column mapping.
 */
export function ImportWizard({ entity, meta, open, onClose, onImported }: ImportWizardProps) {
  const tc = useChrome();
  const dialog = useDialogHost();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Exclude<ImportMode, 'validate'>>('upsert');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  // Column auto-mapping (display-only). A header matches a stored field by
  // fieldname or (case-insensitive) label; system columns are tolerated.
  const mapping = useMemo(() => {
    if (!text.trim()) return { header: [] as string[], matched: [] as string[], unknown: [] as string[] };
    const { header } = parseCsv(text);
    const byName = new Map<string, string>();
    for (const f of meta.fields) {
      if (LAYOUT_FIELD_TYPES.includes(f.fieldtype)) continue;
      byName.set(f.fieldname.toLowerCase(), f.fieldname);
      if (f.label) byName.set(f.label.toLowerCase(), f.fieldname);
    }
    const matched: string[] = [];
    const unknown: string[] = [];
    for (const h of header) {
      const key = h.trim().toLowerCase();
      if (byName.has(key) || SYSTEM_COLS.has(h.trim())) matched.push(h);
      else unknown.push(h);
    }
    return { header, matched, unknown };
  }, [text, meta]);

  const hasData = text.trim().length > 0;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    setReport(null);
  }

  async function run(runMode: ImportMode): Promise<void> {
    if (!hasData) {
      dialog.toast(tc('ui.import.noData'), 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await importRows(entity, { csv: text, mode: runMode });
      const rep = res.data as ImportReport;
      setReport(rep);
      if (runMode !== 'validate') {
        onImported();
        dialog.toast(
          tc('ui.import.committed', {
            inserted: rep.inserted,
            updated: rep.updated,
            failed: rep.failed,
          }),
          rep.failed > 0 ? 'warning' : 'success',
        );
      }
    } catch (err) {
      dialog.toast(err instanceof Error ? err.message : tc('ui.import.commit'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      size="xl"
      title={tc('ui.import.title', { entity: meta.label ?? entity })}
      closeLabel={tc('ui.import.close')}
      footer={
        <div className="flex items-center justify-end gap-2" data-testid="import-wizard-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={!hasData || busy}
            onClick={() => run('validate')}
            data-testid="action:import-dry-run"
          >
            {tc('ui.import.dryRun')}
          </Button>
          <Button
            type="button"
            disabled={!hasData || busy}
            onClick={() => run(mode)}
            data-testid="action:import-commit"
          >
            {tc('ui.import.commit')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-testid="import-wizard" data-entity={entity}>
        {/* Source + mode */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="text-sm text-textMain file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-textMain"
            aria-label={tc('ui.import.chooseFile')}
            data-testid="import-file"
          />
          <div className="ml-auto">
            <SegmentedControl
              aria-label={tc('ui.import.mode')}
              value={mode}
              onChange={(v) => setMode(v as 'upsert' | 'insert')}
              options={[
                { value: 'upsert', label: tc('ui.import.modeUpsert') },
                { value: 'insert', label: tc('ui.import.modeInsert') },
              ]}
            />
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setReport(null);
          }}
          placeholder={tc('ui.import.orPaste')}
          rows={6}
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-textMain focus-visible:shadow-focus focus-visible:outline-none"
          data-testid="import-textarea"
        />

        {/* Column mapping preview */}
        {hasData && (
          <div className="flex flex-col gap-1 text-sm" data-testid="import-mapping">
            <span className="text-textMuted">
              {tc('ui.import.mapped', { count: mapping.matched.length })}
            </span>
            {mapping.unknown.length > 0 && (
              <span className="text-warning-600" data-testid="import-unknown-columns">
                {tc('ui.import.unknownColumns', { columns: mapping.unknown.join(', ') })}
              </span>
            )}
          </div>
        )}

        {/* Report */}
        {report && (
          <div className="flex flex-col gap-2" data-testid="import-report">
            <p className="text-sm text-textMain">
              {report.dry_run
                ? tc('ui.import.dryRunSummary', {
                    inserted: report.inserted,
                    updated: report.updated,
                    failed: report.failed,
                  })
                : tc('ui.import.committed', {
                    inserted: report.inserted,
                    updated: report.updated,
                    failed: report.failed,
                  })}
            </p>
            {report.errors.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">
                    {tc('ui.import.problems', { count: report.errors.length })}
                  </caption>
                  <thead className="bg-subtle text-textMuted">
                    <tr>
                      <th className="px-3 py-2">{tc('ui.import.colRow')}</th>
                      <th className="px-3 py-2">{tc('ui.import.colField')}</th>
                      <th className="px-3 py-2">{tc('ui.import.colMessage')}</th>
                    </tr>
                  </thead>
                  <tbody data-testid="import-errors">
                    {report.errors.map((e, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5 tabular-nums">{e.row}</td>
                        <td className="px-3 py-1.5 font-mono">{e.field ?? ''}</td>
                        <td className="px-3 py-1.5">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </BaseDialog>
  );
}
