import {
  type MemoryAttributes,
  type MemoryObservationEntry,
  memoryCandidates,
  memoryUsedIn,
  type RecordEnvelope,
} from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { fieldLabel, formatShortDay } from '../lib/format.ts';
import { type AboutRecord, memoryLine, memoryOf, strengthWords } from '../lib/memory.ts';
import { recordQuery } from '../queries.ts';
import { AddNote, memoryQuery } from './Memory.tsx';

/**
 * Lab memory on other pages (plan 005, M20): one folded "Lab notes" line on a record's Overview,
 * the "from lab memory" line inside the readiness block, and a memory's own Evidence and Applied in
 * tabs.
 */

/** "Lab notes (3) · 1 rule", folded, opening to one line each and "Add a note about this". */
export function LabNotes({ record }: { record: RecordEnvelope }) {
  const [adding, setAdding] = useState(false);
  const notes = useQuery(memoryQuery({ about: record.id, status: 'active' })).data?.memories;
  if (!notes || record.kind === 'memory') return null;
  const about: AboutRecord = {
    id: record.id,
    name: record.name,
    label: record.label,
    kind: record.kind,
  };
  if (adding) return <AddNote about={about} onClose={() => setAdding(false)} />;
  if (notes.length === 0)
    return (
      <p className="lab-notes muted">
        <button type="button" className="btn small" onClick={() => setAdding(true)}>
          Add a lab note about this
        </button>
      </p>
    );
  const rules = notes.filter((m) => memoryOf(m).strength === 'rule').length;
  return (
    <details className="lab-notes">
      <summary>
        Lab notes <span className="muted num">({notes.length})</span>
        {rules > 0 && <span className="muted"> · {rules === 1 ? '1 rule' : `${rules} rules`}</span>}
      </summary>
      <ul className="plain memory-rows">
        {notes.map((m) => (
          <li key={m.id}>
            <Link to="/records/$id" params={{ id: m.id }} className="linked-name">
              {memoryOf(m).statement} <span className="code">{m.name}</span>
            </Link>
            <div className="muted memory-line">{memoryLine(m)}</div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn small" onClick={() => setAdding(true)}>
        Add a note about this
      </button>
    </details>
  );
}

/** The memories that filled values on this record (`memory` evidence), with the values they filled. */
export function fromLabMemory(record: RecordEnvelope): { id: string; fields: string[] }[] {
  const byMemory = new Map<string, string[]>();
  for (const [field, e] of Object.entries(record.evidence ?? {})) {
    if (e.source !== 'memory' || !e.from) continue;
    byMemory.set(e.from.id, [...(byMemory.get(e.from.id) ?? []), field]);
  }
  return [...byMemory].map(([id, fields]) => ({ id, fields }));
}

/** One line in the readiness block naming the lab memories applied, each linked (M20). */
export function FromLabMemory({ record }: { record: RecordEnvelope }) {
  const used = fromLabMemory(record);
  if (used.length === 0) return null;
  return (
    <p className="from-memory">
      <span className="muted">From lab memory:</span>{' '}
      {used.map((u, i) => (
        <span key={u.id}>
          {i > 0 && '; '}
          <MemoryName id={u.id} />{' '}
          <span className="muted">({u.fields.map(fieldLabel).join(', ')})</span>
        </span>
      ))}
    </p>
  );
}

function MemoryName({ id }: { id: string }) {
  const memory = useQuery(recordQuery(id)).data;
  return (
    <Link to="/records/$id" params={{ id }}>
      {memory ? (memory.attributes as MemoryAttributes).statement : id}
    </Link>
  );
}

function RecordName({ id }: { id: string }) {
  const record = useQuery({ ...recordQuery(id), retry: false }).data;
  return (
    <Link to="/records/$id" params={{ id }}>
      {record ? (
        <>
          {record.label} <span className="code">{record.name}</span>
        </>
      ) : (
        id
      )}
    </Link>
  );
}

const sourceWords: Record<MemoryAttributes['source']['from'], string> = {
  stated: 'Stated by a person',
  conversation: 'From a conversation with the assistant',
  experiment: 'Learned from experiments',
  run: 'Learned from runs',
  analysis: 'Learned from analyses',
  edits: 'People changed the same filled-in value the same way',
};

const findingWords = {
  for: 'showed it',
  against: 'showed the opposite',
  quiet: 'could have shown it and did not',
} as const;

/** A memory's Evidence tab: where it came from, and every record reported for or against it. */
export function MemoryEvidenceTab({ record }: { record: RecordEnvelope }) {
  const a = record.attributes as MemoryAttributes;
  const reported = useQuery({
    queryKey: ['memory', 'evidence', record.id],
    queryFn: () => api.run(memoryCandidates, { memory: record.id }),
  });
  const observations: MemoryObservationEntry[] = (reported.data?.candidates ?? [])
    .flatMap((c) => c.observations)
    .sort((x, y) => y.at.localeCompare(x.at));
  const shown = observations.filter((o) => o.finding !== 'quiet');
  const quiet = observations.filter((o) => o.finding === 'quiet');
  const line = reported.data?.candidates[0]?.evidence.line;
  return (
    <>
      <section className="block" aria-label="Where it came from">
        <header>
          <h2>Where it came from</h2>
          <span className="state muted">{strengthWords[a.strength]}</span>
        </header>
        <div className="body">
          <p>
            {sourceWords[a.source.from]}
            {a.source.note ? `: ${a.source.note}` : '.'}
          </p>
          {a.source.evidence && a.source.evidence.length > 0 && (
            <ul className="plain">
              {a.source.evidence.map((id) => (
                <li key={id}>
                  <RecordName id={id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="block" aria-label="What the lab has seen">
        <header>
          <h2>What the lab has seen</h2>
          {line && <span className="state muted">{line}</span>}
        </header>
        <div className="body">
          {reported.isPending ? (
            <p className="empty">Loading…</p>
          ) : observations.length === 0 ? (
            <p className="empty">
              Nothing reported yet. Detectors and agents add records here when results show it or
              show the opposite.
            </p>
          ) : (
            <>
              {shown.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>It</th>
                        <th>Day</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((o) => (
                        <tr key={`${o.evidence}-${o.at}`}>
                          <td>
                            <RecordName id={o.evidence} />
                          </td>
                          <td className={o.finding === 'against' ? 'warn-ink' : undefined}>
                            {findingWords[o.finding ?? 'for']}
                          </td>
                          <td className="when">{formatShortDay(o.day)}</td>
                          <td>{o.note ?? <span className="muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {quiet.length > 0 && (
                <details className="others">
                  <summary className="others-summary">
                    {quiet.length === 1
                      ? '1 record where it could have shown and did not'
                      : `${quiet.length} records where it could have shown and did not`}
                  </summary>
                  <ul className="plain">
                    {quiet.map((o) => (
                      <li key={`${o.evidence}-${o.at}`}>
                        <RecordName id={o.evidence} />{' '}
                        <span className="muted">{formatShortDay(o.day)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}

/** A memory's Applied in tab: records with values copied from it (memory.used_in, M11). */
export function MemoryAppliedTab({ record }: { record: RecordEnvelope }) {
  const used = useQuery({
    queryKey: ['memory', 'used', record.id],
    queryFn: () => api.run(memoryUsedIn, { id: record.id }),
  });
  const records = used.data?.records ?? [];
  return (
    <section className="block" aria-label="Applied in">
      <header>
        <h2>Applied in</h2>
        <span className="state muted num">{records.length}</span>
      </header>
      <div className="body">
        {used.isPending ? (
          <p className="empty">Loading…</p>
        ) : records.length === 0 ? (
          <p className="empty">No record has a value filled from this memory yet.</p>
        ) : (
          <ul className="plain">
            {records.map((r) => (
              <li key={r.id}>
                <Link to="/records/$id" params={{ id: r.id }} className="linked-name">
                  {r.label} <span className="code">{r.name}</span>
                </Link>{' '}
                <span className="muted">
                  {r.fields.map(fieldLabel).join(', ')}
                  {r.status === 'draft' && ' · draft'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
