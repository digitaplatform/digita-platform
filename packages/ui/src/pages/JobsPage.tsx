import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActionParamDef } from '@digitaplatform/shared';
import { Badge, BaseDialog, Button, Checkbox, Input, Select, cn, tableSkin, TableSkeleton, EmptyState } from '@digitaplatform/components';
import { jobsApi, jobsRole, longRunningActions, type JobDef, type JobRun, type JobInput } from '@/services/jobs';
import { getEntityMeta } from '@/services/meta';
import { getSingle } from '@/services/resource';
import { unwrap } from '@/lib/api-result';
import { localizeMeta } from '@/lib/localize-meta';
import { useMetaCatalog } from '@/hooks/useMeta';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useChrome } from '@/lib/chrome-i18n';
import { ErrorBlock } from '@/components/status';
import { tid } from '@/lib/testid';

/**
 * Jobs panel for the per-tenant digita-jobs satellite. Task-FIRST: the catalog
 * is the fixed set of developer-defined `long_running` actions (what the system
 * can do in the background) — users do NOT author tasks, they schedule and run
 * them. Per task: "Run now" (ensures/reuses a manual job, then triggers it) and
 * "Schedule" (a cron job). Inputs are metadata-driven from the action's
 * `params` (no code, no magic values); single-entity docs resolve automatically.
 * Reachable only when the satellite is alive (menu gate) AND the user carries a
 * jobs role; jobs:Viewer reads, jobs:Admin (or Administrator) manages.
 */

interface JobTask {
  entity: string;
  entityLabel: string;
  isSingle: boolean;
  action: string;
  label: string;
  params: ActionParamDef[];
}

const STATUS_TONE: Record<JobRun['status'], string> = {
  queued: 'bg-subtle text-textMuted',
  running: 'bg-info-light text-info',
  succeeded: 'bg-success-light text-success',
  failed: 'bg-error-light text-error',
  cancelled: 'bg-subtle text-textMuted',
  interrupted: 'bg-warning-light text-warning',
};

/** The job-capable task catalog: every `long_running` action across all
 *  entities, with labels/params localized reactively on the active locale. */
function useJobTasks(): { tasks: JobTask[]; isLoading: boolean } {
  const catalogQ = useMetaCatalog();
  const translations = useI18nStore((s) => s.translations);
  const metasQ = useQuery({
    queryKey: ['jobs-task-metas'],
    enabled: !!catalogQ.data,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const entities = catalogQ.data ?? [];
      const metas = await Promise.all(
        entities.map(async (e) => {
          try {
            return unwrap(await getEntityMeta(e.name));
          } catch {
            return null;
          }
        }),
      );
      return metas.filter((m): m is NonNullable<typeof m> => !!m);
    },
  });
  const tasks = useMemo(
    () =>
      (metasQ.data ?? [])
        .flatMap((raw) => {
          const m = localizeMeta(raw, translations);
          return longRunningActions(m.actions).map((a) => ({
            entity: m.name,
            entityLabel: m.label ?? m.name,
            isSingle: !!m.is_single,
            action: a.action,
            label: a.label,
            params: a.params ?? [],
          }));
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [metasQ.data, translations],
  );
  return { tasks, isLoading: catalogQ.isLoading || metasQ.isLoading };
}

interface DialogState {
  task: JobTask;
  mode: 'run' | 'schedule';
  job?: JobDef;
}

export default function JobsPage() {
  const tc = useChrome();
  const locale = useI18nStore((s) => s.locale);
  const user = useSessionStore((s) => s.user);
  const role = jobsRole((user?.roles as string[] | undefined) ?? []);
  const qc = useQueryClient();
  const { toast, confirm } = useDialogHost();
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const { tasks, isLoading: tasksLoading } = useJobTasks();
  const jobsQ = useQuery({ queryKey: ['jobs'], queryFn: () => jobsApi.list(), refetchInterval: 15000 });
  const runsQ = useQuery({
    queryKey: ['jobs-runs'],
    queryFn: () => jobsApi.runs(),
    // Poll fast while anything is active — the progress bar lives off this.
    refetchInterval: (q) =>
      (q.state.data?.runs ?? []).some((r) => r.status === 'running' || r.status === 'queued') ? 2000 : 10000,
  });

  if (!role) return <ErrorBlock title={tc('ui.jobs.noAccess')} />;
  const jobs = jobsQ.data?.jobs ?? [];
  const runs = runsQ.data?.runs ?? [];
  const isAdmin = role === 'admin';

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['jobs'] });
    void qc.invalidateQueries({ queryKey: ['jobs-runs'] });
  };

  const taskKeys = new Set(tasks.map((t) => `${t.entity}|${t.action}`));
  const jobsForTask = (t: JobTask) => jobs.filter((j) => j.entity === t.entity && j.action === t.action);
  const ungrouped = jobs.filter((j) => !taskKeys.has(`${j.entity}|${j.action}`));

  const runSavedJob = async (job: JobDef) => {
    try {
      await jobsApi.runNow(job._id);
      toast(tc('ui.jobs.runQueued'), 'success');
      invalidate();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const removeJob = async (job: JobDef) => {
    if (!(await confirm({ title: tc('ui.jobs.deleteConfirm'), message: job.name, danger: true }))) return;
    try {
      await jobsApi.remove(job._id);
      invalidate();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const cancelRun = async (run: JobRun) => {
    try {
      await jobsApi.cancel(run._id);
      invalidate();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const renderSavedJobs = (list: JobDef[]) =>
    list.length === 0 ? (
      <div className="text-caption text-textMuted">{tc('ui.jobs.noSchedules')}</div>
    ) : (
      <ul className="space-y-1.5">
        {list.map((j) => (
          <li key={j._id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-caption text-textMuted">
              <span className="text-textMain">{j.name}</span> · {j.schedule ? j.schedule.cron : tc('ui.jobs.manual')}
              {j.next_run_at ? ` · ${new Date(j.next_run_at).toLocaleString(locale)}` : ''}
              {!j.enabled && (
                <Badge className="ml-2" variant="soft">
                  {tc('ui.jobs.disabled')}
                </Badge>
              )}
            </span>
            {isAdmin && (
              <span className="inline-flex gap-2">
                <Button variant="secondary" onClick={() => void runSavedJob(j)} {...tid.action('job-run-now')}>
                  {tc('ui.jobs.runNow')}
                </Button>
                <Button variant="danger" onClick={() => void removeJob(j)}>
                  {tc('ui.action.delete')}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-6" {...tid.page('jobs')}>
      <h1 className="text-h1 font-display text-textMain">{tc('ui.jobs.title')}</h1>

      {tasksLoading ? (
        <TableSkeleton columns={2} rows={3} />
      ) : tasks.length === 0 && ungrouped.length === 0 ? (
        <EmptyState testId="jobs-empty" title={tc('ui.jobs.noTasks')} />
      ) : (
        <div className={cn(tableSkin.frame, 'divide-y divide-border')}>
          {tasks.map((t) => (
            <div key={`${t.entity}|${t.action}`} className="space-y-3 p-4" {...tid.row('task', t.action)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-textMain">{t.label}</div>
                  <div className="text-caption text-textMuted">{t.entityLabel}</div>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 gap-2">
                    <Button onClick={() => setDialog({ task: t, mode: 'run' })} {...tid.action(`task-run-${t.action}`)}>
                      {tc('ui.jobs.runNow')}
                    </Button>
                    <Button variant="secondary" onClick={() => setDialog({ task: t, mode: 'schedule' })}>
                      {tc('ui.jobs.schedule')}
                    </Button>
                  </div>
                )}
              </div>
              {renderSavedJobs(jobsForTask(t))}
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div className="space-y-3 p-4">
              <div className="font-medium text-textMuted">{tc('ui.jobs.ungrouped')}</div>
              {renderSavedJobs(ungrouped)}
            </div>
          )}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-h2 text-textMain">{tc('ui.jobs.recentRuns')}</h2>
        {runsQ.isLoading ? (
          <TableSkeleton columns={5} rows={3} />
        ) : runs.length === 0 ? (
          <EmptyState testId="runs-empty" title={tc('ui.jobs.noRuns')} />
        ) : (
          <div className={cn('overflow-x-auto', tableSkin.frame)}>
            <table className="w-full text-sm">
              <tbody>
                {runs.map((r) => {
                  const pct =
                    r.progress?.total && r.progress.total > 0
                      ? Math.min(100, Math.round((r.progress.completed / r.progress.total) * 100))
                      : null;
                  return (
                    <tr key={r._id} className={cn('last:border-b-0', tableSkin.row)}>
                      <td className="px-4 py-2.5">
                        <span className={cn('rounded-full px-2 py-0.5 text-caption font-medium', STATUS_TONE[r.status])}>
                          {tc(`ui.jobs.status.${r.status}`)}
                        </span>
                      </td>
                      <td className="w-1/3 px-4 py-2.5">
                        {r.status === 'running' && (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                            <div
                              className={cn('h-full rounded-full bg-primary-600 transition-all duration-slow', pct == null && 'animate-pulse w-1/3')}
                              style={pct != null ? { width: `${pct}%` } : undefined}
                            />
                          </div>
                        )}
                        <div className="mt-0.5 text-caption text-textMuted">
                          {/* Localized counts lead; the server's raw progress/error
                              string is technical detail and trails as a suffix. */}
                          {r.progress?.total
                            ? `${tc('ui.jobs.progressOf', { done: r.progress.completed, total: r.progress.total })}${r.progress.message ? ` · ${r.progress.message}` : ''}`
                            : (r.error ?? r.progress?.message ?? tc('ui.jobs.chunks', { n: r.chunks }))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-caption tabular-nums text-textMuted">
                        {new Date(r.created_at).toLocaleString(locale)} · {r.triggered_by}
                      </td>
                      <td className="px-4 py-2.5 text-caption tabular-nums text-textMuted">
                        {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isAdmin && (r.status === 'running' || r.status === 'queued') && (
                          <Button variant="secondary" onClick={() => void cancelRun(r)}>
                            {tc('ui.jobs.cancel')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog && (
        <JobConfigDialog
          key={`${dialog.task.entity}|${dialog.task.action}|${dialog.mode}|${dialog.job?._id ?? 'new'}`}
          task={dialog.task}
          mode={dialog.mode}
          job={dialog.job}
          jobs={jobs}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// ─── Param form (metadata-driven) ────────────────────────────────────────────

export function seedParams(defs: ActionParamDef[], existing?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const fallback =
      d.default ??
      (d.type === 'boolean' ? false : d.type === 'int' ? (d.min ?? 0) : d.type === 'select' ? (d.options?.[0] ?? '') : '');
    out[d.name] = existing?.[d.name] ?? fallback;
  }
  return out;
}

export function coerceParams(defs: ActionParamDef[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = values[d.name];
    if (d.type === 'boolean') {
      out[d.name] = !!v;
    } else if (d.type === 'int') {
      // A cleared number field yields '' (Number('') === 0), which would
      // silently snap to `min` — treat blank/nullish as "use the declared
      // default" instead so an empty box never means "1".
      const raw = typeof v === 'string' ? v.trim() : v;
      const fallback = Number(d.default ?? d.min ?? 0);
      const n = raw === '' || raw == null ? fallback : Number(raw);
      const safe = Number.isFinite(n) ? n : fallback;
      const lo = d.min ?? Number.NEGATIVE_INFINITY;
      const hi = d.max ?? Number.POSITIVE_INFINITY;
      out[d.name] = Math.min(hi, Math.max(lo, safe));
    } else {
      out[d.name] = v ?? '';
    }
  }
  return out;
}

function ParamFields({
  defs,
  values,
  onChange,
}: {
  defs: ActionParamDef[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}) {
  if (defs.length === 0) return null;
  return (
    <div className="space-y-3">
      {defs.map((d) => (
        <div key={d.name} className="space-y-1">
          {d.type === 'boolean' ? (
            <Checkbox
              label={d.label}
              checked={!!values[d.name]}
              onChange={(e) => onChange(d.name, e.target.checked)}
            />
          ) : d.type === 'select' ? (
            <label className="block space-y-1">
              <span className="text-caption text-textMuted">{d.label}</span>
              <Select
                value={String(values[d.name] ?? '')}
                onChange={(v) => onChange(d.name, v)}
                options={(d.options ?? []).map((o) => ({ value: o, label: o }))}
              />
            </label>
          ) : (
            <label className="block space-y-1">
              <span className="text-caption text-textMuted">{d.label}</span>
              <Input
                type={d.type === 'int' ? 'number' : 'text'}
                value={String(values[d.name] ?? '')}
                min={d.min}
                max={d.max}
                onChange={(e) => onChange(d.name, e.target.value)}
              />
            </label>
          )}
          {d.description && <span className="text-micro text-textMuted">{d.description}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Run / Schedule dialog ───────────────────────────────────────────────────

function JobConfigDialog({
  task,
  mode,
  job,
  jobs,
  onClose,
  onDone,
}: {
  task: JobTask;
  mode: 'run' | 'schedule';
  job?: JobDef;
  jobs: JobDef[];
  onClose: () => void;
  onDone: () => void;
}) {
  const tc = useChrome();
  const { toast } = useDialogHost();
  const isSchedule = mode === 'schedule';
  const [doc, setDoc] = useState(job?.doc ?? '');
  const [name, setName] = useState(job?.name ?? task.label);
  const [cron, setCron] = useState(job?.schedule?.cron ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(() => seedParams(task.params, job?.params));
  const [saving, setSaving] = useState(false);

  // Singles carry exactly one document whose id is seed-defined — resolve it
  // instead of asking the user for a magic value like "MAIN".
  const singleDocQ = useQuery({
    queryKey: ['jobs-single-doc', task.entity],
    enabled: task.isSingle,
    staleTime: 5 * 60_000,
    queryFn: async () => String((unwrap(await getSingle(task.entity)) as { _id?: string })._id ?? ''),
  });
  const effectiveDoc = task.isSingle ? (singleDocQ.data ?? '') : doc;
  const valid = !!effectiveDoc && (!isSchedule || (!!cron.trim() && !!name.trim()));

  const submit = async () => {
    setSaving(true);
    try {
      const params = coerceParams(task.params, values);
      if (isSchedule) {
        const body: JobInput = {
          name: name.trim() || task.label,
          entity: task.entity,
          doc: effectiveDoc,
          action: task.action,
          params,
          schedule: { cron: cron.trim() },
        };
        if (job) await jobsApi.update(job._id, body);
        else await jobsApi.create(body);
        toast(tc('ui.jobs.scheduleSaved'), 'success');
      } else {
        // Run now: reuse this task's manual job (schedule null) if one exists,
        // else create it — then trigger. Keeps one manual entry per task+doc.
        const existing = jobs.find(
          (j) => j.entity === task.entity && j.action === task.action && (j.doc ?? '') === effectiveDoc && !j.schedule,
        );
        let jobId: string;
        if (existing) {
          await jobsApi.update(existing._id, {
            name: existing.name,
            entity: existing.entity,
            doc: existing.doc ?? effectiveDoc,
            action: existing.action,
            params,
            schedule: null,
            enabled: existing.enabled,
          });
          jobId = existing._id;
        } else {
          const res = await jobsApi.create({
            name: task.label,
            entity: task.entity,
            doc: effectiveDoc,
            action: task.action,
            params,
            schedule: null,
          });
          jobId = res.job._id;
        }
        await jobsApi.runNow(jobId);
        toast(tc('ui.jobs.runQueued'), 'success');
      }
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseDialog
      open
      onClose={onClose}
      title={isSchedule ? tc('ui.jobs.scheduleTitle') : tc('ui.jobs.runTitle')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tc('ui.action.cancel')}
          </Button>
          <Button disabled={!valid || saving} onClick={() => void submit()} {...tid.action('job-save')}>
            {isSchedule ? tc('ui.jobs.save') : tc('ui.jobs.runNow')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-caption text-textMuted">
          {task.label} — {task.entityLabel}
        </div>
        {isSchedule && (
          <label className="block space-y-1">
            <span className="text-caption text-textMuted">{tc('ui.jobs.name')}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={task.label} />
          </label>
        )}
        {!task.isSingle && (
          <label className="block space-y-1">
            <span className="text-caption text-textMuted">{tc('ui.jobs.doc')}</span>
            <Input value={doc} onChange={(e) => setDoc(e.target.value)} />
            <span className="text-micro text-textMuted">{tc('ui.jobs.docHint')}</span>
          </label>
        )}
        <ParamFields defs={task.params} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
        {isSchedule && (
          <label className="block space-y-1">
            <span className="text-caption text-textMuted">{tc('ui.jobs.cron')}</span>
            <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 3 * * *" />
            <span className="text-micro text-textMuted">{tc('ui.jobs.cronHint')}</span>
          </label>
        )}
      </div>
    </BaseDialog>
  );
}
