import {
  assaysSaveFromExperiment,
  designerFeasibility,
  type ExperimentAttributes,
  type PlateMapAttributes,
  type RecordEnvelope,
  type TransferPlanAttributes,
} from '@ailab/schema';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { useAssistant } from '../assistant.tsx';
import { formatValue } from '../lib/format.ts';
import { assistantSetupQuery, readinessQuery, recordsQuery } from '../queries.ts';

/**
 * The experiment's design on its own page (plan 017b-3, P1): the experiment, its plate maps and
 * its transfer plans read as one design. The Overview carries the readiness of all three and what
 * the lab can do; the Plates tab (redesign) and the Transfers tab (here) carry the documents.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The plate maps and transfer plans drafted for an experiment, not archived. */
function useDesignDocuments(experiment: string) {
  const mapQuery = useQuery(recordsQuery({ kind: 'plate_map' }));
  const maps = mapQuery.data ?? [];
  const plans = useQuery(recordsQuery({ kind: 'transfer_plan' })).data ?? [];
  const mine = <T,>(records: RecordEnvelope[]) =>
    records.filter(
      (r) =>
        r.status !== 'archived' &&
        (r.attributes as T & { experiment?: string }).experiment === experiment,
    );
  return {
    maps: mine<PlateMapAttributes>(maps),
    plans: mine<TransferPlanAttributes>(plans),
    mapsPending: mapQuery.isPending,
    mapsError: mapQuery.error,
  };
}

/** The experiment and the documents designed with it, each with what is left before it is confirmed. */
export function DesignBlock({ record }: { record: RecordEnvelope }) {
  const { maps, plans } = useDesignDocuments(record.id);
  const canSave =
    record.status === 'active' && (record.attributes as ExperimentAttributes).template;
  if (maps.length === 0 && plans.length === 0 && !canSave) return null;
  const rows: { record: RecordEnvelope; what: string }[] = [
    { record, what: 'Experiment' },
    ...maps.map((m) => ({ record: m, what: 'Plate map' })),
    ...plans.map((p) => ({ record: p, what: 'Transfer plan' })),
  ];
  const confirmed = rows.filter((r) => r.record.status === 'active').length;
  return (
    <section className="block" aria-label="Design">
      <header>
        <h2>Design</h2>
        <span className={`state ${confirmed === rows.length ? 'ok-ink' : 'muted'}`}>
          {confirmed === rows.length
            ? '✓ all confirmed'
            : `${confirmed} of ${rows.length} confirmed`}
        </span>
      </header>
      <div className="body">
        <ul className="plain design-rows">
          {rows.map((r) => (
            <DesignRow
              key={r.record.id}
              record={r.record}
              what={r.what}
              self={r.record.id === record.id}
            />
          ))}
        </ul>
        <p className="muted">Work downstream uses confirmed versions only.</p>
        <SaveAsTemplate record={record} />
      </div>
    </section>
  );
}

function DesignRow({
  record,
  what,
  self,
}: {
  record: RecordEnvelope;
  what: string;
  self: boolean;
}) {
  const readiness = useQuery({
    ...readinessQuery(record.id),
    enabled: record.status !== 'active',
  }).data;
  const blockers =
    readiness?.checks.filter((c) => !c.passed && c.severity === 'blocker').length ?? 0;
  const state =
    record.status === 'active'
      ? readiness && !readiness.ready
        ? 'change waiting'
        : 'confirmed'
      : !readiness
        ? 'draft'
        : blockers > 0
          ? `draft · ${plural(blockers, 'thing')} to fix`
          : 'draft · ready to confirm';
  return (
    <li>
      <span className="muted">{what}</span>{' '}
      {self ? (
        <span>{record.label}</span>
      ) : (
        <Link to="/records/$id" params={{ id: record.id }}>
          {record.label}
        </Link>
      )}{' '}
      <span className="code">{record.name}</span>{' '}
      <span className={record.status === 'active' ? 'ok-ink' : blockers > 0 ? 'warn-ink' : 'muted'}>
        {state}
      </span>
    </li>
  );
}

const verdictWords = {
  ready: 'ready',
  not_ready: 'only instruments in maintenance or out of service',
  missing: 'no registered instrument can do it',
} as const;

/** Whether the lab can run the design now (designer.feasibility, 017b-2): instruments, totals, amounts, stock. */
export function FeasibilityBlock({ record }: { record: RecordEnvelope }) {
  const a = record.attributes as ExperimentAttributes;
  const feasibility = useQuery({
    queryKey: ['record', record.id, 'feasibility', record.version],
    queryFn: () => api.run(designerFeasibility, { experiment: record.id }),
    enabled: a.template !== undefined && record.status !== 'archived',
    retry: false,
  });
  if (!a.template) return null;
  const f = feasibility.data;
  const blocking = f
    ? [
        ...f.needs
          .filter((n) => n.verdict !== 'ready')
          .map((n) => `${n.for}: ${verdictWords[n.verdict]}`),
        ...f.amounts.problems,
        ...f.stock
          .filter((s) => s.verdict === 'short')
          .map((s) => s.note ?? `${s.record?.label ?? s.role} is short`),
      ]
    : [];
  const unknown = f?.stock.filter((s) => s.verdict === 'unknown') ?? [];
  return (
    <section className="block" aria-label="Can the lab run it">
      <header>
        <h2>Can the lab run it?</h2>
        {f && (
          <span className={`state ${f.feasible ? 'ok-ink' : 'warn-ink'}`}>
            {f.feasible ? '✓ yes, as designed' : `${plural(blocking.length, 'thing')} in the way`}
          </span>
        )}
      </header>
      <div className="body">
        {feasibility.isPending ? (
          <p className="empty">Checking…</p>
        ) : feasibility.error ? (
          <p className="error-text">{feasibility.error.message}</p>
        ) : f ? (
          <>
            {f.totals ? (
              <p>
                {plural(f.totals.conditions, 'condition')} on {plural(f.totals.plates, 'plate')} per
                run; {plural(f.totals.totalPlates, 'plate')} and{' '}
                {plural(f.totals.totalWells, 'well')} in all.
              </p>
            ) : (
              <p className="muted">
                Plates and wells are worked out once the subjects are records.
              </p>
            )}
            {blocking.length > 0 && (
              <>
                <h3 className="group-title">Required before running</h3>
                <ul className="plain">
                  {blocking.map((line) => (
                    <li key={line} className="warn-ink">
                      {line}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {f.needs.length > 0 && (
              <details className="others">
                <summary className="others-summary">
                  Instruments ({f.needs.filter((n) => n.verdict === 'ready').length} of{' '}
                  {f.needs.length} ready)
                </summary>
                <ul className="plain">
                  {f.needs.map((n) => (
                    <li key={`${n.for}-${n.capability}`}>
                      {n.for}:{' '}
                      {n.instruments.length === 0 ? (
                        <span className="warn-ink">none registered</span>
                      ) : (
                        n.instruments.map((i, k) => (
                          <span key={i.id}>
                            {k > 0 && ', '}
                            <Link to="/records/$id" params={{ id: i.id }}>
                              {i.label}
                            </Link>
                            {i.preferred && <span className="muted"> (preferred)</span>}
                            {i.status !== 'ready' && (
                              <span className="muted"> · {i.status.replaceAll('_', ' ')}</span>
                            )}
                          </span>
                        ))
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {f.stock.length > 0 && (
              <details className="others">
                <summary className="others-summary">
                  Stock ({f.stock.filter((s) => s.verdict === 'enough').length} of {f.stock.length}{' '}
                  enough{unknown.length > 0 ? `, ${unknown.length} not known` : ''})
                </summary>
                <ul className="plain">
                  {f.stock.map((s) => (
                    <li key={`${s.part}-${s.variable}`}>
                      {s.note ??
                        `${s.record?.label ?? s.role}: ${s.needed ? `needs ${formatValue(s.needed)}` : 'amount not worked out'}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

/** The Transfers tab: the transfer plans drafted for the experiment, each with its groups. */
function isCurrentConfirmed(record: RecordEnvelope) {
  return (
    record.status === 'active' &&
    record.readiness?.blockers === 0 &&
    record.readiness.sectionsLeft.length === 0 &&
    record.readiness.changed.length === 0
  );
}

export function ExperimentTransfers({ record }: { record: RecordEnvelope }) {
  const { maps, plans, mapsPending, mapsError } = useDesignDocuments(record.id);
  const assistant = useAssistant();
  const setup = useQuery(assistantSetupQuery);
  const [selectedMap, setSelectedMap] = useState('');
  const [failed, setFailed] = useState(false);
  const confirmedMaps = maps.filter(isCurrentConfirmed);
  const map =
    confirmedMaps.length === 1
      ? confirmedMaps[0]
      : confirmedMaps.find((candidate) => candidate.id === selectedMap);
  const canStart =
    isCurrentConfirmed(record) &&
    !!map &&
    !mapsPending &&
    !mapsError &&
    setup.data?.configured === true &&
    !assistant.sending &&
    !assistant.running;
  const start = async () => {
    if (!canStart || !map) return;
    setFailed(false);
    setFailed(!(await startTransferPlanning(assistant.send, record, map)));
  };
  return (
    <section className="block" aria-label="Transfers">
      <header>
        <h2>Transfers</h2>
        <span className="state muted num">{plans.length}</span>
      </header>
      <div className="body">
        <p>Plan the liquid transfers for a plate map in this experiment.</p>
        {confirmedMaps.length > 1 && (
          <label>
            Plate map
            <select
              className="field"
              value={selectedMap}
              onChange={(e) => setSelectedMap(e.target.value)}
            >
              <option value="">Choose a plate map</option>
              {confirmedMaps.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={!canStart}
            onClick={() => void start()}
          >
            Plan transfers
          </button>
        </div>
        {mapsPending ? (
          <p className="muted">Checking plate maps…</p>
        ) : mapsError ? (
          <p className="error-text">Could not load plate maps: {mapsError.message}</p>
        ) : !isCurrentConfirmed(record) ? (
          <p className="muted">Finish reviewing the experiment before planning transfers.</p>
        ) : confirmedMaps.length === 0 ? (
          <p className="muted">Confirm a plate map on the Plates tab before planning transfers.</p>
        ) : confirmedMaps.length > 1 && !map ? (
          <p className="muted">Choose the plate map whose wells you want to fill.</p>
        ) : null}
        {setup.isPending && <p className="muted">Checking assistant availability…</p>}
        {setup.isError && (
          <p className="error-text">
            Could not check assistant availability: {setup.error.message}
          </p>
        )}
        {setup.data?.configured === false && <p className="muted">The assistant is unavailable.</p>}
        {(assistant.sending || assistant.running) && (
          <p className="muted">The assistant is working.</p>
        )}
        {failed && <p className="error-text">Could not start transfer planning. Try again.</p>}
        {plans.length === 0 ? (
          <p className="empty">No transfer plans for this experiment yet.</p>
        ) : (
          <ul className="plain design-rows">
            {plans.map((p) => {
              const a = p.attributes as TransferPlanAttributes;
              const transfers = a.groups.reduce((n, g) => n + g.transfers.length, 0);
              return (
                <li key={p.id}>
                  <Link to="/records/$id" params={{ id: p.id }} className="linked-name">
                    {p.label} <span className="code">{p.name}</span>
                  </Link>
                  <span className="muted">
                    {' '}
                    · {p.status === 'active' ? 'confirmed' : 'draft'}
                    {a.rerunOf && ' · reruns failed transfers'}
                  </span>
                  <div className="muted">
                    {plural(a.plates.length, 'plate')}, {plural(transfers, 'transfer')}
                    {a.purpose ? ` · ${a.purpose}` : ''}
                  </div>
                  {a.groups.length > 0 && (
                    <ul className="plain">
                      {a.groups.map((g) => (
                        <li key={g.id}>
                          {g.label}{' '}
                          <span className="muted">({plural(g.transfers.length, 'transfer')})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Send an exact design handoff; the assistant checks live records and chooses supported operations. */
export function startTransferPlanning(
  send: ReturnType<typeof useAssistant>['send'],
  experiment: RecordEnvelope,
  map: RecordEnvelope,
) {
  const message =
    `Plan liquid transfers for ${map.label} in ${experiment.label}. ` +
    'Read both designs and check any existing transfer plans before drafting; if a design has changed or a plan already covers these wells, explain what remains. ' +
    'Check the actual source containers and wells, stock concentrations, final well volume, solvent limits and suitable instrument. ' +
    'Ask me about missing facts instead of guessing. Use the lab calculators to work out feasible volumes and show any uncertainty. ' +
    'Draft only the liquid transfers supported by this plate map and leave the plan for my review.';
  return send(message, {
    fresh: true,
    context: {
      record: { id: map.id, name: map.name, version: map.version },
    },
  });
}

/**
 * "Save as a template" on a confirmed experiment designed from a template (017b-3): its SOP
 * versions, the values it set and the records it bound become a new draft template, the rest is
 * copied from the template it came from. An experiment drafted another way is saved by asking the
 * assistant, which can supply the essential inputs, replicates and readouts it lacks.
 */
function SaveAsTemplate({ record }: { record: RecordEnvelope }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(record.label);
  const save = useMutation({
    mutationFn: () =>
      api.run(assaysSaveFromExperiment, { experiment: record.id, label: label.trim() }),
    onSuccess: ({ template }) => navigate({ to: '/records/$id', params: { id: template.id } }),
  });
  const a = record.attributes as ExperimentAttributes;
  if (record.status !== 'active' || !a.template) return null;
  if (!open)
    return (
      <div className="actions">
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Save as a template
        </button>
      </div>
    );
  return (
    <form
      className="edit-fields"
      aria-label="Save as a template"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label>
        Template name
        <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <button type="submit" className="btn primary" disabled={save.isPending || !label.trim()}>
        Save
      </button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {save.error && <p className="error-text">{save.error.message}</p>}
      <p className="muted">
        A new draft template with this experiment's SOP versions, values and records; you confirm it
        on its page.
      </p>
    </form>
  );
}
