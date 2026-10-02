import {
  type CampaignAttributes,
  type ExperimentAttributes,
  experimentsCalculate,
  experimentsConclude,
  experimentsSetStage,
  type RecordEnvelope,
  type RunAttributes,
  type RunStep,
  runsDoneAsPlanned,
  runsFinish,
  runsRecordDeviation,
  runsRecordStep,
  runsStart,
  type SetAttributes,
  setsGet,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { api } from '../api.ts';
import {
  nextActions,
  plannedText,
  runProgress,
  runStatusWords,
  stageSteps,
  stageWords,
} from '../lib/experiments.ts';
import { formatValue, formatWhen } from '../lib/format.ts';
import { recordQuery, recordsQuery } from '../queries.ts';
import { Head, page } from './AreaHead.tsx';
import { useLabels } from './Instruments.tsx';
import { RecordList } from './Records.tsx';

/**
 * Campaign, experiment, run and set screens (plan 013d). Summaries first: the next thing to do and
 * where each thing stands; the full design stays in the section blocks below.
 */

const campaignOf = (r: RecordEnvelope) => r.attributes as CampaignAttributes;
const experimentOf = (r: RecordEnvelope) => r.attributes as ExperimentAttributes;
const runOf = (r: RecordEnvelope) => r.attributes as RunAttributes;

export function CampaignsPage() {
  return (
    <>
      <Head
        page={page('campaign')}
        lede="The lab's projects: a goal, the aims that reach it, and the experiments that serve each aim."
      />
      <RecordList
        title="Campaigns"
        kind="campaign"
        placeholder="Find by title or name, e.g. BRD4 or CAM-001"
        empty="No campaigns yet. Ask the assistant to draft one from a goal, or load the seed lab."
        columns={[
          { header: 'Stage', cell: (r) => campaignOf(r).stage.replace('_', ' ') },
          { header: 'Aims', cell: (r) => campaignOf(r).aims.length, className: 'num' },
        ]}
      />
    </>
  );
}

export function ExperimentsPage() {
  const campaigns = useLabels('campaign');
  return (
    <>
      <Head
        page={page('experiment')}
        lede="Each experiment asks one question, follows confirmed SOP versions, and is run one or more times."
      />
      <RecordList
        title="Experiments"
        kind="experiment"
        placeholder="Find by title or name, e.g. ELISA or EXP-0001"
        empty="No experiments yet. Ask the assistant to draft one from a question."
        columns={[
          { header: 'Stage', cell: (r) => stageWords[experimentOf(r).stage] },
          {
            header: 'Campaign',
            cell: (r) => campaigns.get(experimentOf(r).campaign) ?? '—',
            className: 'muted',
          },
          { header: 'SOPs', cell: (r) => experimentOf(r).protocol.length, className: 'num' },
        ]}
      />
    </>
  );
}

export function RunsPage() {
  const experiments = useLabels('experiment');
  return (
    <>
      <Head
        page={page('run')}
        lede="Each run is one go at an experiment's confirmed design on a day: a checklist of its steps, what went differently, and the data that came out."
      />
      <RecordList
        title="Runs"
        kind="run"
        placeholder="Find by title or name, e.g. RUN-0001"
        empty="No runs yet. Start one from a planned experiment."
        columns={[
          { header: 'Status', cell: (r) => runStatusWords[runOf(r).status] },
          {
            header: 'Experiment',
            cell: (r) => experiments.get(runOf(r).experiment.id) ?? '—',
            className: 'muted',
          },
          {
            header: 'Steps',
            cell: (r) => {
              const p = runProgress(runOf(r));
              return `${p.ticked} of ${p.total}`;
            },
            className: 'num',
          },
        ]}
      />
    </>
  );
}

export function SetsPage() {
  return (
    <>
      <Head
        page={page('set')}
        lede="Lists of hits one experiment hands to the next, each with the reason its members made it."
      />
      <RecordList
        title="Sets"
        kind="set"
        placeholder="Find by title or name, e.g. SET-001"
        empty="No sets yet. They are made when an experiment concludes."
        columns={[
          {
            header: 'Members',
            cell: (r) => (r.attributes as SetAttributes).members.length,
            className: 'num',
          },
          {
            header: 'Why',
            cell: (r) => (r.attributes as SetAttributes).criterion,
            className: 'muted',
          },
        ]}
      />
    </>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries();
}

function RecordName({ record }: { record: RecordEnvelope }) {
  return (
    <Link to="/records/$id" params={{ id: record.id }}>
      <span className="mono">{record.name}</span> {record.label}
    </Link>
  );
}

/** A campaign's aims, each with the experiments serving it and where they stand. */
export function CampaignBlocks({ record }: { record: RecordEnvelope }) {
  const a = campaignOf(record);
  const experiments = (useQuery(recordsQuery({ kind: 'experiment' })).data ?? []).filter(
    (e) => experimentOf(e).campaign === record.id && e.status !== 'archived',
  );
  const byAim = (aim: string | undefined) =>
    experiments.filter((e) => (experimentOf(e).aim ?? undefined) === aim);
  const unassigned = experiments.filter(
    (e) => !a.aims.some((aim) => aim.id === experimentOf(e).aim),
  );
  return (
    <section className="block" aria-label="Aims and experiments">
      <header>
        <h2>Aims and experiments</h2>
        <span className="state muted num">{experiments.length} experiments</span>
      </header>
      <div className="body">
        {a.aims.map((aim) => (
          <div key={aim.id}>
            <p>
              <b>{aim.text}</b>
              {aim.success && <span className="muted"> · done when {aim.success}</span>}
            </p>
            <ExperimentRows experiments={byAim(aim.id)} />
          </div>
        ))}
        {unassigned.length > 0 && (
          <div>
            <p>
              <b>Not tied to an aim</b>
            </p>
            <ExperimentRows experiments={unassigned} />
          </div>
        )}
      </div>
    </section>
  );
}

function ExperimentRows({ experiments }: { experiments: RecordEnvelope[] }) {
  if (experiments.length === 0) return <p className="empty">No experiments yet.</p>;
  return (
    <ul>
      {experiments.map((e) => {
        const x = experimentOf(e);
        return (
          <li key={e.id}>
            <RecordName record={e} /> <span className="muted">· {stageWords[x.stage]}</span>
            {x.conclusion && <span> · {x.conclusion.summary}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Where an experiment stands, what to do next, its runs and its conclusion. */
export function ExperimentBlocks({ record }: { record: RecordEnvelope }) {
  return (
    <>
      <NextStepBlock record={record} />
      <RunsBlock record={record} />
      <ConclusionBlock record={record} />
    </>
  );
}

function NextStepBlock({ record }: { record: RecordEnvelope }) {
  const a = experimentOf(record);
  const refresh = useRefresh();
  const navigate = useNavigate();
  const calc = useQuery({
    queryKey: ['record', record.id, 'experiment', 'calculate', record.version],
    queryFn: () => api.run(experimentsCalculate, { id: record.id }),
    enabled: a.protocol.length > 0,
  });
  const problems = (calc.data?.parts ?? []).flatMap((p) => p.problems);
  const stage = useMutation({
    mutationFn: (to: 'planned' | 'analysing') =>
      api.run(experimentsSetStage, {
        id: record.id,
        expectedVersion: record.version,
        stage: to,
      }),
    onSuccess: refresh,
  });
  const start = useMutation({
    mutationFn: () =>
      api.run(runsStart, { experiment: record.id, expectedVersion: record.version }),
    onSuccess: async (run) => {
      await refresh();
      await navigate({ to: '/records/$id', params: { id: run.id } });
    },
  });
  const [concluding, setConcluding] = useState(false);
  const actions = nextActions(a.stage, record.status);
  const error = stage.error ?? start.error;
  const steps = stageSteps(a.stage);
  return (
    <section className="block" aria-label="Next step">
      <header>
        <h2>Next step</h2>
        {steps.length === 0 && <span className="state muted">{stageWords[a.stage]}</span>}
      </header>
      <div className="body">
        {steps.length > 0 && (
          <ol className="stages" aria-label="Stages">
            {steps.map((s) => (
              <li
                key={s.stage}
                className={`stage-${s.at}`}
                aria-current={s.at === 'current' ? 'step' : undefined}
              >
                {s.at === 'done' && <span aria-hidden="true">✓ </span>}
                {stageWords[s.stage]}
              </li>
            ))}
          </ol>
        )}
        {record.status === 'draft' && (
          <p className="muted">Confirm the design below; then it can be planned.</p>
        )}
        {a.protocol.length > 0 &&
          (problems.length > 0 ? (
            <details>
              <summary className="warn-ink">
                The protocol doesn't work out yet ({problems.length} to settle)
              </summary>
              <ul>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          ) : (
            calc.data && <p className="ok-ink">Every value of the protocol works out.</p>
          ))}
        {actions.length === 0 && record.status === 'active' && (
          <p className="muted">Nothing left to do here.</p>
        )}
        <div className="actions">
          {actions.includes('plan') && (
            <button
              type="button"
              className="btn primary"
              disabled={stage.isPending}
              onClick={() => stage.mutate('planned')}
            >
              Plan it
            </button>
          )}
          {actions.includes('start_run') && (
            <button
              type="button"
              className="btn primary"
              disabled={start.isPending}
              onClick={() => start.mutate()}
            >
              Start a run
            </button>
          )}
          {actions.includes('analyse') && (
            <button
              type="button"
              className="btn"
              disabled={stage.isPending}
              onClick={() => stage.mutate('analysing')}
            >
              Runs are done; analyse
            </button>
          )}
          {actions.includes('conclude') && !concluding && (
            <button type="button" className="btn" onClick={() => setConcluding(true)}>
              Conclude
            </button>
          )}
        </div>
        {error && <p className="error-text">{error.message}</p>}
        {concluding && <ConcludeForm record={record} onDone={() => setConcluding(false)} />}
      </div>
    </section>
  );
}

type VerdictChoice = 'supported' | 'refuted' | 'inconclusive';

function ConcludeForm({ record, onDone }: { record: RecordEnvelope; onDone: () => void }) {
  const a = experimentOf(record);
  const refresh = useRefresh();
  const [summary, setSummary] = useState('');
  const [verdicts, setVerdicts] = useState<Record<string, VerdictChoice>>({});
  const conclude = useMutation({
    mutationFn: () =>
      api.run(experimentsConclude, {
        id: record.id,
        expectedVersion: record.version,
        summary: summary.trim(),
        ...(a.hypotheses?.length
          ? {
              verdicts: a.hypotheses.flatMap((h) => {
                const verdict = verdicts[h.id];
                return verdict ? [{ hypothesis: h.id, verdict }] : [];
              }),
            }
          : {}),
      }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    conclude.mutate();
  };
  const complete =
    summary.trim().length > 0 && (a.hypotheses ?? []).every((h) => verdicts[h.id] !== undefined);
  return (
    <form className="form-rows" onSubmit={submit} aria-label="Conclude">
      {(a.hypotheses ?? []).map((h) => (
        <div className="form-row" key={h.id}>
          <span className="name">{h.statement}</span>
          <div className="control">
            <select
              aria-label={`Verdict on ${h.statement}`}
              value={verdicts[h.id] ?? ''}
              onChange={(e) =>
                setVerdicts({ ...verdicts, [h.id]: e.target.value as VerdictChoice })
              }
            >
              <option value="">Choose…</option>
              <option value="supported">Supported</option>
              <option value="refuted">Refuted</option>
              <option value="inconclusive">Inconclusive</option>
            </select>
          </div>
        </div>
      ))}
      <div className="form-row">
        <label className="name" htmlFor="conclusion-summary">
          What was found
        </label>
        <div className="control">
          <textarea
            id="conclusion-summary"
            className="grow"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>
      </div>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={!complete || conclude.isPending}>
          Conclude the experiment
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      {conclude.error && <p className="error-text">{conclude.error.message}</p>}
    </form>
  );
}

function RunsBlock({ record }: { record: RecordEnvelope }) {
  const runs = (useQuery(recordsQuery({ kind: 'run' })).data ?? []).filter(
    (r) => runOf(r).experiment.id === record.id,
  );
  if (runs.length === 0) return null;
  return (
    <section className="block" aria-label="Runs">
      <header>
        <h2>Runs</h2>
        <span className="state muted num">{runs.length}</span>
      </header>
      <div className="body">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Date</th>
                <th>Status</th>
                <th className="num">Steps</th>
                <th className="num">Went differently</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const a = runOf(r);
                const p = runProgress(a);
                return (
                  <tr key={r.id}>
                    <td>
                      <RecordName record={r} />
                    </td>
                    <td className="when">{a.date ?? '—'}</td>
                    <td>{runStatusWords[a.status]}</td>
                    <td className="num">
                      {p.ticked} of {p.total}
                    </td>
                    <td className={p.deviations ? 'num warn-ink' : 'num'}>{p.deviations}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const verdictInk = { supported: 'ok-ink', refuted: 'crit-ink', inconclusive: 'muted' } as const;

function ConclusionBlock({ record }: { record: RecordEnvelope }) {
  const a = experimentOf(record);
  const c = a.conclusion;
  if (!c) return null;
  const statement = new Map((a.hypotheses ?? []).map((h) => [h.id, h.statement]));
  return (
    <section className="block" aria-label="Conclusion">
      <header>
        <h2>Conclusion</h2>
        <span className="state muted">{formatWhen(c.at)}</span>
      </header>
      <div className="body">
        <p>{c.summary}</p>
        {(c.verdicts ?? []).length > 0 && (
          <ul>
            {(c.verdicts ?? []).map((v) => (
              <li key={v.hypothesis}>
                {statement.get(v.hypothesis) ?? v.hypothesis}:{' '}
                <b className={verdictInk[v.verdict]}>{v.verdict}</b>
                {v.note && <span className="muted"> · {v.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** A run at the bench: tick each step as planned, or say what went differently. */
export function RunBlocks({ record }: { record: RecordEnvelope }) {
  const a = runOf(record);
  const open = a.status === 'in_progress';
  const p = runProgress(a);
  const refresh = useRefresh();
  const target = { id: record.id, expectedVersion: record.version };
  const allDone = useMutation({
    mutationFn: () => api.run(runsDoneAsPlanned, target),
    onSuccess: refresh,
  });
  const finish = useMutation({
    mutationFn: (status: 'done' | 'failed' | 'aborted') =>
      api.run(runsFinish, { ...target, status }),
    onSuccess: refresh,
  });
  const experiment = useQuery(recordQuery(a.experiment.id)).data;
  return (
    <>
      <section className="block" aria-label="Checklist">
        <header>
          <h2>Checklist</h2>
          <span className="state muted num">
            {runStatusWords[a.status]} · {p.ticked} of {p.total} steps
            {p.deviations > 0 && ` · ${p.deviations} went differently`}
          </span>
        </header>
        <div className="body">
          {experiment && (
            <p className="muted">
              Follows <RecordName record={experiment} /> as confirmed in version{' '}
              {a.experiment.version}.
            </p>
          )}
          <ol className="sop-steps">
            {(a.steps ?? []).map((s) => (
              <RunStepRow key={`${s.part}-${s.step}`} record={record} step={s} open={open} />
            ))}
          </ol>
          {open && (
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={allDone.isPending || p.ticked === p.total}
                onClick={() => allDone.mutate()}
              >
                The rest went as planned
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={finish.isPending || p.ticked < p.total}
                onClick={() => finish.mutate('done')}
              >
                Finish the run
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={finish.isPending}
                onClick={() => finish.mutate('failed')}
              >
                It failed
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={finish.isPending}
                onClick={() => finish.mutate('aborted')}
              >
                Abort
              </button>
            </div>
          )}
          {(allDone.error ?? finish.error) && (
            <p className="error-text">{(allDone.error ?? finish.error)?.message}</p>
          )}
        </div>
      </section>
      <DeviationsBlock record={record} open={open} />
    </>
  );
}

function RunStepRow({
  record,
  step,
  open,
}: {
  record: RecordEnvelope;
  step: RunStep;
  open: boolean;
}) {
  const refresh = useRefresh();
  const [mode, setMode] = useState<'none' | 'changed' | 'skipped'>('none');
  const [values, setValues] = useState<Record<string, string>>({});
  const [why, setWhy] = useState('');
  const tick = useMutation({
    mutationFn: (how: 'done' | 'changed' | 'skipped') =>
      api.run(runsRecordStep, {
        id: record.id,
        expectedVersion: record.version,
        part: step.part,
        step: step.step,
        ...(how === 'skipped' ? { skipped: true, why: why.trim() } : {}),
        ...(how === 'changed'
          ? {
              changed: step.planned.flatMap((p) => {
                const typed = values[p.name]?.trim();
                if (!typed) return [];
                const quantity =
                  typeof p.value === 'object' && p.value && 'unit' in p.value
                    ? { value: typed, unit: p.value.unit }
                    : typed;
                return [{ name: p.name, value: quantity }];
              }),
              why: why.trim(),
            }
          : {}),
      }),
    onSuccess: async () => {
      await refresh();
      setMode('none');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode !== 'none') tick.mutate(mode);
  };
  const planned = plannedText(step);
  return (
    <li>
      <p className="sop-line">
        <b>{step.title}.</b>{' '}
        {step.status === 'pending' ? (
          <span className="muted">to do</span>
        ) : (
          <span className={step.deviation ? 'warn-ink' : 'ok-ink'}>
            {step.status === 'skipped' ? 'skipped' : step.deviation ? 'done, with changes' : 'done'}
            {step.at && ` · ${formatWhen(step.at)}`}
          </span>
        )}
      </p>
      {planned && <p className="sop-line muted sop-note">Planned: {planned}</p>}
      {step.deviation && (
        <p className="sop-line warn-ink sop-note">
          {step.deviation.what}. Why: {step.deviation.why}
          {step.deviation.impact && `. Impact: ${step.deviation.impact}`}
        </p>
      )}
      {open && step.status === 'pending' && mode === 'none' && (
        <div className="actions">
          <button
            type="button"
            className="btn small"
            disabled={tick.isPending}
            onClick={() => tick.mutate('done')}
          >
            Done as planned
          </button>
          {step.planned.length > 0 && (
            <button type="button" className="btn small" onClick={() => setMode('changed')}>
              Something differed
            </button>
          )}
          <button type="button" className="btn small" onClick={() => setMode('skipped')}>
            Skipped
          </button>
        </div>
      )}
      {mode !== 'none' && (
        <form className="actions" onSubmit={submit} aria-label={`${step.title}: what differed`}>
          {mode === 'changed' &&
            step.planned.map((p) => (
              <label key={p.name}>
                {p.name}{' '}
                <input
                  className="num"
                  size={8}
                  placeholder={formatValue(p.value)}
                  value={values[p.name] ?? ''}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                />
              </label>
            ))}
          <label>
            <span className="sr-only">Why</span>
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why" />
          </label>
          <button
            type="submit"
            className="btn small primary"
            disabled={
              tick.isPending ||
              !why.trim() ||
              (mode === 'changed' && !Object.values(values).some((v) => v.trim()))
            }
          >
            Record
          </button>
          <button type="button" className="btn small" onClick={() => setMode('none')}>
            Cancel
          </button>
        </form>
      )}
      {tick.error && <p className="error-text">{tick.error.message}</p>}
    </li>
  );
}

function DeviationsBlock({ record, open }: { record: RecordEnvelope; open: boolean }) {
  const a = runOf(record);
  const refresh = useRefresh();
  const [what, setWhat] = useState('');
  const [why, setWhy] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api.run(runsRecordDeviation, {
        id: record.id,
        expectedVersion: record.version,
        what: what.trim(),
        why: why.trim(),
      }),
    onSuccess: async () => {
      await refresh();
      setWhat('');
      setWhy('');
    },
  });
  const deviations = a.deviations ?? [];
  if (!open && deviations.length === 0) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <section className="block" aria-label="Anything else that went differently">
      <header>
        <h2>Anything else that went differently</h2>
        <span className="state muted num">{deviations.length}</span>
      </header>
      <div className="body">
        {deviations.length > 0 && (
          <ul>
            {deviations.map((d) => (
              <li key={`${d.at}-${d.what}`}>
                {d.what}. <span className="muted">Why: {d.why}</span>
                {d.impact && <span className="muted"> · Impact: {d.impact}</span>}
              </li>
            ))}
          </ul>
        )}
        {open && (
          <form className="actions" onSubmit={submit} aria-label="Record a deviation">
            <label>
              <span className="sr-only">What happened</span>
              <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What" />
            </label>
            <label>
              <span className="sr-only">Why</span>
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why" />
            </label>
            <button
              type="submit"
              className="btn small"
              disabled={add.isPending || !what.trim() || !why.trim()}
            >
              Record
            </button>
          </form>
        )}
        {add.error && <p className="error-text">{add.error.message}</p>}
      </div>
    </section>
  );
}

/** A set's members and the experiments that test it. */
export function SetBlocks({ record }: { record: RecordEnvelope }) {
  const { data, error } = useQuery({
    queryKey: ['record', record.id, 'set', record.version],
    queryFn: () => api.run(setsGet, { id: record.id }),
  });
  const a = record.attributes as SetAttributes;
  return (
    <section className="block" aria-label="Members">
      <header>
        <h2>Members</h2>
        <span className="state muted num">{a.members.length}</span>
      </header>
      <div className="body">
        <p className="muted">Why these: {a.criterion}</p>
        {error && <p className="error-text">{error.message}</p>}
        {data && (
          <>
            <ul>
              {data.members.map((m) => (
                <li key={m.id}>
                  <Link to="/records/$id" params={{ id: m.id }}>
                    <span className="mono">{m.name}</span> {m.label}
                  </Link>
                  {m.note && <span className="muted"> · {m.note}</span>}
                </li>
              ))}
            </ul>
            {data.usedBy.length > 0 && (
              <p>
                Tested by{' '}
                {data.usedBy.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ', '}
                    <Link to="/records/$id" params={{ id: e.id }}>
                      <span className="mono">{e.name}</span> {e.label}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
