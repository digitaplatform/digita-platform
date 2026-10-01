import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActionParamDef } from '@digitaplatform/shared';
import { Badge, BaseDialog, Button, Checkbox, Input, Select, cn, tableSkin, TableSkeleton, EmptyState } from '@digitaplatform/components';
import { appEngine, jobsApi, jobsRole, longRunningActions, ownApp, type JobDef, type JobRun, type JobInput } from '@/services/jobs';
import { unwrap } from '@/lib/api-result';
import { localizeMeta } from '@/lib/localize-meta';
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
 * A tenant with several apps picks the app first: the catalog is the chosen app's
 * engine's, and a job carries the app it was scheduled for.
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

/** An entity of the catalog whose definition the engine did not answer: its tasks are missing. */
interface DefinitionFailure {
  entity: string;
  message: string;
}

/** The job-capable task catalog of one app's engine (appEngine; null = this app's own): every
 *  `long_running` action across all entities, with labels/params localized reactively on the
 *  active locale. Waits for the apps, so the page never lists another engine's tasks first.
 *  One unreadable definition costs only its own entity's tasks, and `failures` names it. */
function useJobTasks(
  app: string | null,
  enabled: boolean,
): { tasks: JobTask[]; failures: DefinitionFailure[]; isLoading: boolean; error: Error | null; reload: () => void } {
  const translations = useI18nStore((s) => s.translations);
  const qc = useQueryClient();
  const metasQ = useQuery({
    queryKey: ['jobs-task-metas', app],
    enabled,
    // The read succeeds even when definitions failed, so TanStack never retries it: a result with
    // failures must not count as fresh, or the next visit shows the same failure for five minutes.
    staleTime: (q) => (q.state.data?.failures.length ? 0 : 5 * 60_000),
    queryFn: async () => {
      const entities = unwrap(await appEngine.catalog(app));
      const reads = await Promise.allSettled(entities.map(async (e) => unwrap(await appEngine.entity(app, e.name))));
      return {
        metas: reads.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
        failures: reads.flatMap((r, i): DefinitionFailure[] =>
          r.status === 'rejected'
            ? [{ entity: entities[i]!.name, message: r.reason instanceof Error ? r.reason.message : String(r.reason) }]
            : [],
        ),
      };
    },
  });
  const tasks = useMemo(
    () =>
      (metasQ.data?.metas ?? [])
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
  return {
    tasks,
    failures: metasQ.data?.failures ?? [],
    isLoading: metasQ.isLoading,
    error: metasQ.error,
    reload: () => void qc.invalidateQueries({ queryKey: ['jobs-task-metas', app] }),
  };
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
  const [chosenApp, setChosenApp] = useState<string | null>(null);

  const appsQ = useQuery({ queryKey: ['jobs-apps'], queryFn: () => jobsApi.apps(), staleTime: 5 * 60_000 });
  // The apps the operator can pick. None where this app is served at the root (services/jobs.ts
  // ownApp): another app's engine is reached only by its path on the tenant host.
  const apps = ownApp === null ? [] : appsQ.data?.apps ?? [];
  // The app a job without `app` runs on; null when the jobs service names no default.
  const defaultApp = appsQ.data?.default ?? null;
  // The app the page shows and every save names. null: the page has no app to name, and shows
  // its own engine's tasks and every job, as it did before the jobs service named apps.
  const selectedApp =
    apps.length > 0 ? (chosenApp ?? defaultApp ?? (ownApp !== null && apps.includes(ownApp) ? ownApp : apps[0]!)) : null;
  const {
    tasks,
    failures: definitionFailures,
    isLoading: tasksLoading,
    error: tasksError,
    reload: reloadTasks,
  } = useJobTasks(selectedApp, appsQ.isSuccess);
  const jobsQ = useQuery({ queryKey: ['jobs'], queryFn: () => jobsApi.list(), refetchInterval: 15000 });
  const runsQ = useQuery({
    queryKey: ['jobs-runs'],
    queryFn: () => jobsApi.runs(),
    // Poll fast while anything is active — the progress bar lives off this.
    refetchInterval: (q) =>
      (q.state.data?.runs ?? []).some((r) => r.status === 'running' || r.status === 'queued') ? 2000 : 10000,
  });

  if (!role) return <ErrorBlock title={tc('ui.jobs.noAccess')} />;
  const allJobs = jobsQ.data?.jobs ?? [];
  // A job without `app` runs on the default app. A job the page cannot place under an app of the
  // list (the service names no default, or the tenant no longer has the job's app) shows under every app.
  const appOf = (j: JobDef) => j.app ?? defaultApp;
  const jobs = selectedApp === null ? allJobs : allJobs.filter((j) => appOf(j) === selectedApp || !apps.includes(appOf(j) ?? ''));
  // Runs of another app's jobs stay out; a run whose job is gone still shows.
  const otherAppJobs = new Set(allJobs.filter((j) => !jobs.includes(j)).map((j) => j._id));
  const runs = (runsQ.data?.runs ?? []).filter((r) => !otherAppJobs.has(r.job));
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

  // Until the saved jobs are read, no task can say it has none. Only a job under its task can be
  // edited: the dialog builds the params from the task's definition.
  const renderSavedJobs = (list: JobDef[], task?: JobTask) =>
    list.length === 0 ? (
      jobsQ.isSuccess && <div className="text-caption text-textMuted">{tc('ui.jobs.noSchedules')}</div>
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
                {task && (
                  <Button variant="secondary" onClick={() => setDialog({ task, mode: 'schedule', job: j })} {...tid.action('job-edit')}>
                    {tc('ui.jobs.edit')}
                  </Button>
                )}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-display text-textMain">{tc('ui.jobs.title')}</h1>
        {apps.length > 1 && (
          <div className="w-64" {...tid.component('jobs-app')}>
            <Select
              value={selectedApp ?? ''}
              onChange={setChosenApp}
              options={apps.map((a) => ({ value: a, label: a }))}
            />
          </div>
        )}
      </div>
      {jobsQ.error && <ErrorBlock title={tc('ui.jobs.jobsLoadFailed')} detail={jobsQ.error.message} />}
      {definitionFailures.map((f) => (
        <div key={f.entity} className="space-y-2">
          <ErrorBlock title={tc('ui.jobs.tasksLoadFailed', { entity: f.entity })} detail={f.message} />
          <Button variant="secondary" onClick={reloadTasks} {...tid.action('jobs-tasks-reload')}>
            {tc('ui.action.reload')}
          </Button>
        </div>
      ))}
      {appsQ.error ? (
        <ErrorBlock detail={appsQ.error.message} />
      ) : appsQ.isPending || tasksLoading ? (
        <TableSkeleton columns={2} rows={3} />
      ) : tasksError ? (
        <ErrorBlock detail={tasksError.message} />
      ) : tasks.length === 0 && ungrouped.length === 0 ? (
        definitionFailures.length === 0 && <EmptyState testId="jobs-empty" title={tc('ui.jobs.noTasks')} />
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
                    <Button
                      variant="secondary"
                      onClick={() => setDialog({ task: t, mode: 'schedule' })}
                      {...tid.action(`task-schedule-${t.action}`)}
                    >
                      {tc('ui.jobs.schedule')}
                    </Button>
                  </div>
                )}
              </div>
              {renderSavedJobs(jobsForTask(t), t)}
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
        {runsQ.error && <ErrorBlock title={tc('ui.jobs.runsLoadFailed')} detail={runsQ.error.message} />}
        {runsQ.isLoading ? (
          <TableSkeleton columns={5} rows={3} />
        ) : runs.length === 0 ? (
          runsQ.isSuccess && <EmptyState testId="runs-empty" title={tc('ui.jobs.noRuns')} />
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
          key={`${selectedApp}|${dialog.task.entity}|${dialog.task.action}|${dialog.mode}|${dialog.job?._id ?? 'new'}`}
          app={selectedApp}
          task={dialog.task}
          mode={dialog.mode}
          job={dialog.job}
          jobs={selectedApp === null ? jobs : jobs.filter((j) => appOf(j) === selectedApp)}
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
  app,
  task,
  mode,
  job,
  jobs,
  onClose,
  onDone,
}: {
  /** The app whose engine runs the job; every save names it. null: the page has no app to name. */
  app: string | null;
  task: JobTask;
  mode: 'run' | 'schedule';
  job?: JobDef;
  /** The saved jobs that run on `app`: a run now reuses the manual one of its task, so a PUT never moves a job of another engine. */
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
    queryKey: ['jobs-single-doc', app, task.entity],
    enabled: task.isSingle,
    staleTime: 5 * 60_000,
    queryFn: async () => String(unwrap(await appEngine.single(app, task.entity))._id ?? ''),
  });
  const effectiveDoc = task.isSingle ? (singleDocQ.data ?? '') : doc;
  // A new schedule needs its cron. An edited job may go without one and is then run by hand only,
  // as the cron field's label says.
  const valid = !!effectiveDoc && (!isSchedule || (!!name.trim() && (!!job || !!cron.trim())));

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
          app: app ?? undefined,
          params,
          schedule: cron.trim() ? { cron: cron.trim() } : null,
        };
        // PUT replaces the job: what the dialog does not show goes back as the job has it, the app
        // included, so an edit never moves a job to the engine the page happens to show.
        if (job)
          await jobsApi.update(job._id, {
            ...body,
            app: job.app,
            enabled: job.enabled,
            timeout_minutes: job.timeout_minutes,
            max_attempts: job.max_attempts,
          });
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
            app: app ?? undefined,
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
            app: app ?? undefined,
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
