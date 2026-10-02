import {
  type MemoryKind,
  type MemoryStrength,
  memoryRemember,
  memoryReplace,
  memoryRetire,
  memorySearch,
  memoryUpdate,
  recordsConfirm,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useDeferredValue, useState } from 'react';
import { api } from '../api.ts';
import {
  type AboutRecord,
  groupMemories,
  memoryLine,
  memoryOf,
  type ShownMemory,
} from '../lib/memory.ts';
import { recordsQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import { Head, page } from './AreaHead.tsx';
import { RecordSearch } from './RecordSearch.tsx';

/**
 * The Lab memory page (plan 005d, M19): memories grouped by what they are about, worked out from
 * their links; rules first; a filter row; "due for a check" folded at the top; "Add a lab note".
 */

const kinds: [MemoryKind, string][] = [
  ['convention', 'Conventions'],
  ['preference', 'Preferences'],
  ['quirk', 'Quirks'],
  ['lesson', 'Lessons'],
  ['fact', 'Facts'],
];
const strengths: [MemoryStrength | 'all', string][] = [
  ['all', 'All'],
  ['rule', 'Rules'],
  ['default', 'Defaults'],
  ['note', 'Notes'],
];
const statuses = [
  ['active', 'Current'],
  ['draft', 'Drafts'],
  ['retired', 'Retired'],
] as const;

export const memoryQuery = (filters: {
  text?: string;
  kind?: MemoryKind;
  strength?: MemoryStrength;
  status: 'active' | 'draft' | 'retired';
  about?: string;
}) => ({
  queryKey: ['memory', filters],
  queryFn: async () => {
    const found = await api.run(memorySearch, { ...filters, limit: 200 });
    return { ...found, memories: found.memories as ShownMemory[] };
  },
});

export function MemoryPage() {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MemoryKind | ''>('');
  const [strength, setStrength] = useState<MemoryStrength | 'all'>('all');
  const [status, setStatus] = useState<'active' | 'draft' | 'retired'>('active');
  const words = useDeferredValue(text.trim());
  const { data, isPending, error } = useQuery(
    memoryQuery({
      status,
      ...(words ? { text: words } : {}),
      ...(kind ? { kind } : {}),
      ...(strength === 'all' ? {} : { strength }),
    }),
  );
  const memories = data?.memories ?? [];
  const due = memories.filter((m) => m.due);
  const groups = groupMemories(memories);
  const narrowed = Boolean(words || kind || strength !== 'all');
  return (
    <>
      <Head
        page={page('memory')}
        lede="What the lab has learned that no registry has a field for: conventions, preferences, instrument quirks, lessons from results and facts. Rules bind designs, defaults fill values no record decides, notes only inform."
        actions={
          <button
            type="button"
            className="btn"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            Add a lab note
          </button>
        }
      />
      {adding && <AddNote onClose={() => setAdding(false)} />}
      <section className="block" aria-label="Find lab memory">
        <div className="body">
          <div className="toolbar">
            <input
              className="field grow"
              type="search"
              placeholder="Find by words, e.g. STAR or blocking"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Find lab memory"
            />
            <select
              className="field"
              aria-label="Kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as MemoryKind | '')}
            >
              <option value="">Any kind</option>
              {kinds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <fieldset className="segmented">
              <legend className="sr-only">Strength</legend>
              {strengths.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={strength === value}
                  onClick={() => setStrength(value)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <fieldset className="segmented">
              <legend className="sr-only">Status</legend>
              {statuses.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>
          {error && <p className="error-text">{error.message}</p>}
          {isPending ? (
            <p className="empty">Loading…</p>
          ) : memories.length === 0 ? (
            <p className="empty">
              {narrowed
                ? 'Nothing matches.'
                : status === 'active'
                  ? 'No lab memory yet. Add a lab note, tell the assistant "remember that…", or load the seed lab.'
                  : status === 'draft'
                    ? 'No drafts waiting. Agents propose lab memory here and in Review.'
                    : 'Nothing retired.'}
            </p>
          ) : (
            <p className="muted num">
              {data?.total === memories.length
                ? `${memories.length} shown`
                : `${memories.length} of ${data?.total} shown; narrow the search for the rest`}
            </p>
          )}
          {due.length > 0 && (
            <details className="others">
              <summary className="others-summary">Due for a check ({due.length})</summary>
              <MemoryRows memories={due} />
            </details>
          )}
        </div>
      </section>
      {groups.map((g) => (
        <section key={g.group} className="block" aria-label={g.group}>
          <header>
            <h2>{g.group}</h2>
            <span className="state muted num">
              {g.records.reduce((n, r) => n + r.memories.length, 0)}
            </span>
          </header>
          <div className="body memory-groups">
            {g.records.map((r) => (
              <div key={r.under?.id ?? ''}>
                {r.under && (
                  <h3 className="group-title">
                    <Link to="/records/$id" params={{ id: r.under.id }} className="linked-name">
                      {r.under.label} <span className="code">{r.under.name}</span>
                    </Link>{' '}
                    <span className="muted num">{r.memories.length}</span>
                  </h3>
                )}
                <MemoryRows memories={r.memories} under={r.under} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/** One memory per line: its statement, then one grey line, with its other links as tags. */
export function MemoryRows({
  memories,
  under,
}: {
  memories: readonly ShownMemory[];
  under?: AboutRecord | undefined;
}) {
  const me = useMe();
  const [changing, setChanging] = useState<string>();
  return (
    <ul className="plain memory-rows">
      {memories.map((m) => {
        const a = memoryOf(m);
        const others = m.aboutRecords.filter((r) => r.id !== under?.id);
        return (
          <li key={m.id}>
            <Link to="/records/$id" params={{ id: m.id }} className="linked-name">
              {a.statement} <span className="code">{m.name}</span>
            </Link>
            <div className="muted memory-line">
              {memoryLine(m)}
              {a.appliesTo.to === 'person' &&
                (a.appliesTo.user === me?.user.id ? ' · yours' : " · another person's")}
              {others.map((r) => (
                <span key={r.id}>
                  {' · '}
                  <Link to="/records/$id" params={{ id: r.id }}>
                    {r.label}
                  </Link>
                </span>
              ))}
              {m.status !== 'archived' && changing !== m.id && (
                <>
                  {' · '}
                  <button type="button" className="btn small" onClick={() => setChanging(m.id)}>
                    Change
                  </button>
                </>
              )}
            </div>
            {m.status === 'draft' && <ConfirmDraft memory={m} />}
            {changing === m.id && (
              <ChangeMemory memory={m} onClose={() => setChanging(undefined)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Add a lab note" (M12): a person's own statement is active at once. A note is the default; a
 * rule is a visible choice. Give `about` to file it under a record ("Add a note about this").
 */
export function AddNote({ onClose, about }: { onClose: () => void; about?: AboutRecord }) {
  const queryClient = useQueryClient();
  const [statement, setStatement] = useState('');
  const [kind, setKind] = useState<MemoryKind>('convention');
  const [strength, setStrength] = useState<MemoryStrength>('note');
  const [when, setWhen] = useState('');
  const [record, setRecord] = useState<string | undefined>(about?.id);
  const [mine, setMine] = useState(false);
  const me = useMe();
  const records = useQuery({ ...recordsQuery({ status: 'active' }), enabled: !about }).data ?? [];
  const remember = useMutation({
    mutationFn: () =>
      api.run(memoryRemember, {
        statement: statement.trim(),
        kind,
        strength,
        ...(record ? { about: [record] } : {}),
        ...(when.trim() ? { when: when.trim() } : {}),
        ...(mine && me ? { appliesTo: { to: 'person' as const, user: me.user.id } } : {}),
        source: { from: 'stated' as const },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
      onClose();
    },
  });
  return (
    <section className="block" aria-label="Add a lab note">
      <header>
        <h2>{about ? `Add a note about ${about.label}` : 'Add a lab note'}</h2>
      </header>
      <div className="body">
        <form
          className="form-rows"
          onSubmit={(e) => {
            e.preventDefault();
            remember.mutate();
          }}
        >
          <MemoryFieldRows
            statement={statement}
            setStatement={setStatement}
            kind={kind}
            setKind={setKind}
            strength={strength}
            setStrength={setStrength}
          />
          {!about && (
            <div className="form-row">
              <span className="name">About</span>
              <span className="control">
                <RecordSearch
                  records={records}
                  value={record}
                  onChange={setRecord}
                  label="About"
                  empty="the whole lab"
                />
              </span>
            </div>
          )}
          <WhenRow when={when} setWhen={setWhen} />
          <label className="form-row">
            <span className="name">Who it is for</span>
            <span className="control">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{' '}
              only me (my own preference)
            </span>
          </label>
          {remember.error && <p className="error-text">{remember.error.message}</p>}
          <div className="toolbar">
            <button
              type="submit"
              className="btn primary"
              disabled={!statement.trim() || remember.isPending}
            >
              Remember
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function MemoryFieldRows({
  statement,
  setStatement,
  kind,
  setKind,
  strength,
  setStrength,
}: {
  statement: string;
  setStatement: (v: string) => void;
  kind: MemoryKind;
  setKind: (v: MemoryKind) => void;
  strength: MemoryStrength;
  setStrength: (v: MemoryStrength) => void;
}) {
  return (
    <>
      <label className="form-row">
        <span className="name">What the lab should know</span>
        <span className="control">
          <textarea
            className="field grow"
            rows={2}
            maxLength={500}
            required
            placeholder="e.g. Block ELISA plates with 2% BSA in PBS, never milk"
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
        </span>
      </label>
      <div className="form-row">
        <span className="name">Kind</span>
        <span className="control">
          <select
            className="field"
            aria-label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as MemoryKind)}
          >
            {kinds.map(([value, label]) => (
              <option key={value} value={value}>
                {label.replace(/s$/, '').toLowerCase()}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="form-row">
        <span className="name">How strongly</span>
        <span className="control">
          <fieldset className="segmented">
            <legend className="sr-only">How strongly</legend>
            {(
              [
                ['note', 'Note: only informs'],
                ['default', 'Default: fills a value'],
                ['rule', 'Rule: designs follow it'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={strength === value}
                onClick={() => setStrength(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </span>
      </div>
    </>
  );
}

function WhenRow({ when, setWhen }: { when: string; setWhen: (v: string) => void }) {
  return (
    <label className="form-row">
      <span className="name">When it applies</span>
      <span className="control">
        <input
          className="field grow"
          placeholder="optional, e.g. volumes below 5 µL"
          value={when}
          maxLength={300}
          onChange={(e) => setWhen(e.target.value)}
        />
      </span>
    </label>
  );
}

/** An agent's draft memory: one Confirm makes it lab memory (rule 8). */
function ConfirmDraft({ memory }: { memory: ShownMemory }) {
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => api.run(recordsConfirm, { id: memory.id, expectedVersion: memory.version }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memory'] }),
  });
  return (
    <div className="toolbar">
      <button
        type="button"
        className="btn small primary"
        disabled={confirm.isPending}
        onClick={() => confirm.mutate()}
      >
        Confirm
      </button>
      {confirm.error && <span className="error-text">{confirm.error.message}</span>}
    </div>
  );
}

type Change = 'correct' | 'replace' | 'retire';

const changes: [Change, string, string][] = [
  [
    'correct',
    'Correct it',
    'Fix how it is worded or how strongly it holds; it stays the same memory.',
  ],
  [
    'replace',
    'Replace it',
    'The lab changed: a new memory takes over, and this one is kept as retired, linked to it.',
  ],
  ['retire', 'Retire it', 'It no longer holds: it stays in history and stops applying.'],
];

/**
 * Change a memory in place (005d-3): correct it (memory.update), replace it with a new one
 * (memory.replace, active memories only) or retire it with why (memory.retire).
 */
function ChangeMemory({ memory, onClose }: { memory: ShownMemory; onClose: () => void }) {
  const queryClient = useQueryClient();
  const a = memoryOf(memory);
  const [change, setChange] = useState<Change>('correct');
  const [statement, setStatement] = useState(a.statement);
  const [kind, setKind] = useState<MemoryKind>(a.kind);
  const [strength, setStrength] = useState<MemoryStrength>(a.strength);
  const [when, setWhen] = useState(a.when ?? '');
  const [why, setWhy] = useState('');
  const offered = changes.filter(([c]) => c !== 'replace' || memory.status === 'active');
  const save = useMutation({
    mutationFn: async () => {
      const target = { id: memory.id, expectedVersion: memory.version };
      if (change === 'retire') return api.run(memoryRetire, { ...target, why: why.trim() });
      const fields = {
        statement: statement.trim(),
        kind,
        strength,
      };
      if (change === 'correct')
        return api.run(memoryUpdate, { ...target, ...fields, when: when.trim() || null });
      const { retired: _, checkAgain: __, when: ___, ...kept } = a;
      return api.run(memoryReplace, {
        ...target,
        why: why.trim(),
        with: {
          ...kept,
          ...fields,
          ...(when.trim() ? { when: when.trim() } : {}),
          source: { from: 'stated' as const },
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
      onClose();
    },
  });
  const ready =
    change === 'retire'
      ? why.trim() !== ''
      : statement.trim() !== '' && (change === 'correct' || why.trim() !== '');
  const hint: ReactNode = changes.find(([c]) => c === change)?.[2];
  return (
    <form
      className="form-rows memory-change"
      aria-label={`Change ${memory.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="form-row">
        <span className="name">Change</span>
        <span className="control">
          <fieldset className="segmented">
            <legend className="sr-only">Change</legend>
            {offered.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={change === value}
                onClick={() => setChange(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <span className="muted">{hint}</span>
        </span>
      </div>
      {change !== 'retire' && (
        <>
          <MemoryFieldRows
            statement={statement}
            setStatement={setStatement}
            kind={kind}
            setKind={setKind}
            strength={strength}
            setStrength={setStrength}
          />
          <WhenRow when={when} setWhen={setWhen} />
        </>
      )}
      {change !== 'correct' && (
        <label className="form-row">
          <span className="name">
            {change === 'retire' ? 'Why it no longer holds' : 'What changed'}
          </span>
          <span className="control">
            <input
              className="field grow"
              required
              maxLength={300}
              placeholder="e.g. the STAR was serviced on 2026-10-01"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
          </span>
        </label>
      )}
      {save.error && <p className="error-text">{save.error.message}</p>}
      <div className="toolbar">
        <button type="submit" className="btn primary" disabled={!ready || save.isPending}>
          {change === 'retire' ? 'Retire' : change === 'replace' ? 'Replace' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
