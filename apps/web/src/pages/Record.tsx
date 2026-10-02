import type {
  Configuration,
  Connection,
  InventoryEvent,
  OverviewFact,
  OverviewPart,
  PlateMapAttributes,
  Readiness,
  RecordEnvelope,
  RecordVersion,
} from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
import {
  actorLabel,
  diffRecords,
  formatShortDay,
  formatValue,
  formatWhen,
  isAgent,
  operationVerb,
  proposalTouches,
} from '../lib/format.ts';
import { kindNoun, kindPage } from '../lib/kinds.ts';
import {
  historyQuery,
  ledgerQuery,
  linksQuery,
  overviewQuery,
  pendingProposalsQuery,
  readinessQuery,
  recordQuery,
} from '../queries.ts';
import { useMe } from '../session.ts';
import { AllFields } from './AllFields.tsx';
import { AssayTemplateBlocks } from './AssayDesign.tsx';
import { DocumentBlocks } from './Documents.tsx';
import { CampaignBlocks, ExperimentBlocks, RunBlocks, SetBlocks } from './Experiments.tsx';
import { InstalledEquipment, InstrumentBlocks, WorkcellBlocks } from './Instruments.tsx';
import { ContainerBlocks, EntityBlocks, WhereIsBlock } from './Inventory.tsx';
import { kindTabs } from './KindTabs.tsx';
import { LabNotes } from './LabNotes.tsx';
import { LabwareDrawing } from './LabwareDrawing.tsx';
import { MentionedIn } from './Mentions.tsx';
import { OpentronsBlock } from './OpentronsBlock.tsx';
import { LayoutBlocks, PlateMapBlocks } from './PlateMaps.tsx';
import { LiquidClassBlocks, ProductBlocks } from './Reagents.tsx';
import { RecordActions, RestoreVersion } from './RecordActions.tsx';
import { fieldLabel, ReadinessBlock } from './RecordReview.tsx';
import { SinceYouLooked } from './SinceYouLooked.tsx';
import { SopPage } from './SopPage.tsx';
import { StatusChip } from './StatusChip.tsx';
import { renderValue } from './Value.tsx';

const operationWords: Record<string, string> = {
  create: 'created',
  update: 'edited',
  activate: 'confirmed and activated',
  confirm_section: 'confirmed',
  archive: 'archived',
  unarchive: 'unarchived',
  restore: 'restored an earlier version',
};

/**
 * One record (plan 004f N4): its name with the code as a tag, an identity line and its key facts,
 * then tabs in a fixed order: Overview (what needs doing, the record's own picture and blocks),
 * the kind's own tabs (`KindTabs.tsx`), History, Connections and All fields.
 */
export function RecordPage() {
  const { id } = useParams({ from: '/app/records/$id' });
  const { tab = 'overview' } = useSearch({ from: '/app/records/$id' });
  const navigate = useNavigate({ from: '/records/$id' });
  const record = useQuery(recordQuery(id));
  const overview = useQuery(overviewQuery(id)).data;
  const history = useQuery(historyQuery(id));
  const readiness = useQuery(readinessQuery(id)).data;
  const ledger =
    useQuery({
      ...ledgerQuery(id, record.data?.version ?? 0),
      enabled: record.data?.kind === 'container',
    }).data ?? [];
  const from = useQuery(linksQuery(id, 'from')).data ?? [];
  const to = useQuery(linksQuery(id, 'to')).data ?? [];
  const pending = (useQuery(pendingProposalsQuery).data ?? []).filter((p) =>
    proposalTouches(p, id),
  );
  // The part open in an editor: on All fields, or the SOP editor on the Overview.
  const [editing, setEditing] = useState<string>();
  const [scrollTo, setScrollTo] = useState<string>();
  useEffect(() => {
    if (!scrollTo) return;
    const part = document.getElementById(`section-${scrollTo}`);
    part?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    part?.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
    setScrollTo(undefined);
  }, [scrollTo]);

  if (record.error) return <RecordMissing id={id} error={record.error} />;
  const r = record.data;
  if (!r) return <p className="empty">Loading…</p>;
  const versions = [...(history.data ?? [])].sort((a, b) => b.version - a.version);
  const isSop = r.kind === 'sop' && (readiness?.sections.length ?? 0) > 0;
  const open = (next: string) =>
    navigate({ search: next === 'overview' ? {} : { tab: next }, replace: true });
  // "Fix in …" and an estimate's name open the part where it is edited.
  const fix = (section: string) => {
    setEditing(section);
    if (!isSop) {
      void open('fields');
      setScrollTo(section);
    }
  };
  const failing = readiness?.checks.some((c) => !c.passed) ?? false;
  const toReview = readiness
    ? readiness.sections.length > 0
      ? readiness.sections.filter((s) => s.state === 'needs_review').length
      : r.status === 'draft'
        ? 1
        : 0
    : 0;
  const showReadiness = readiness && !isSop && (r.status === 'draft' || toReview > 0 || failing);
  const render = (value: unknown, field?: string) => {
    const view = field ? fieldViews[`${r.kind}/${field}`] : undefined;
    return view ? view(value, r) : renderValue(value, field);
  };
  const ownTabs = kindTabs[r.kind] ?? [];
  const tabs: { id: string; label: string; count?: string; warn?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    ...ownTabs.map((t) => {
      const n = t.count?.(r, to);
      return { id: t.id, label: t.label, ...(n === undefined ? {} : { count: String(n) }) };
    }),
    { id: 'history', label: 'History', count: String(versions.length + ledger.length) },
    { id: 'connections', label: 'Connections', count: String(from.length + to.length) },
    {
      id: 'fields',
      label: 'All fields',
      ...(toReview > 0
        ? {
            // A kind without parts is reviewed as a whole: no count to give.
            count: readiness?.sections.length ? `${toReview} to review` : 'to review',
            warn: true,
          }
        : {}),
    },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <div className="record-page">
      <div className="page-head record-head">
        <div>
          {r.kind === 'plate_map' ? (
            <PlateMapCrumbs record={r} />
          ) : (
            <div className="crumbs">
              lab / {kindPage(r.kind) && <>{kindPage(r.kind)?.area.toLowerCase()} / </>}
              {kindPage(r.kind) ? (
                <Link to={kindPage(r.kind)?.path ?? '/records'}>
                  {kindPage(r.kind)?.title.toLowerCase()}
                </Link>
              ) : (
                <Link to="/records">records</Link>
              )}{' '}
              / <b>{r.name}</b>
            </div>
          )}
          <h1>
            {r.label} <span className="code">{r.name}</span>
          </h1>
          <Identity parts={overview?.identity} fallback={kindNoun(r.kind)} />
        </div>
        <div className="head-side">
          <StatusChip record={r} />
          <RecordActions record={r} />
        </div>
      </div>

      <nav className="tabs" aria-label="Parts of this record">
        {tabs.map((t) => (
          <Link
            key={t.id}
            to="/records/$id"
            params={{ id }}
            search={t.id === 'overview' ? {} : { tab: t.id }}
            replace
            className={t.id === current ? 'tab on' : 'tab'}
            aria-current={t.id === current ? 'page' : undefined}
          >
            {t.label}
            {t.count && <span className={t.warn ? 'count warn-ink' : 'count'}>{t.count}</span>}
          </Link>
        ))}
      </nav>

      {current === 'overview' && (
        <>
          {pending.length > 0 && (
            <p className="agent-ink">
              {pending.length === 1
                ? 'An agent has proposed a change'
                : `Agents have proposed ${pending.length} changes`}{' '}
              to this record. <Link to="/review">Review it</Link>
            </p>
          )}
          <SinceYouLooked key={r.id} record={r} />
          {showReadiness && (
            <ReadinessBlock
              record={r}
              readiness={readiness}
              titles={
                readiness.sections.length > 0
                  ? Object.fromEntries(readiness.sections.map((s) => [s.id, s.title]))
                  : { fields: 'the fields' }
              }
              onFix={fix}
              editing={editing}
            />
          )}
          {overview && overview.facts.length > 0 && (
            <KeyFacts facts={overview.facts} marked={unsourcedFields(r, readiness)} />
          )}
          <LabNotes record={r} />
          {isSop && readiness ? (
            <SopPage record={r} readiness={readiness} editing={editing} onEdit={setEditing} />
          ) : (
            <KindBlocks record={r} />
          )}
          {r.kind !== 'document' && <MentionedIn record={r} />}
        </>
      )}

      {ownTabs.map((t) => t.id === current && <Fragment key={t.id}>{t.render(r)}</Fragment>)}

      {current === 'history' && <History record={r} versions={versions} ledger={ledger} />}

      {current === 'connections' && <Connections from={from} to={to} />}

      {current === 'fields' && readiness && (
        <AllFields
          record={r}
          readiness={readiness}
          renderValue={render}
          editing={isSop ? undefined : editing}
          onEdit={(part) => {
            if (isSop && part) {
              setEditing(part);
              void open('overview');
            } else setEditing(part);
          }}
        />
      )}
    </div>
  );
}

/**
 * A plate map is its layout filled in (N5), so its crumb goes through the layout:
 * "lab / library / plate layouts / IL-6 ELISA, 96 wells → for EXP-0004".
 */
function PlateMapCrumbs({ record }: { record: RecordEnvelope }) {
  const a = record.attributes as PlateMapAttributes;
  const layout = useQuery(recordQuery(a.layout.id)).data;
  const experiment = useQuery({ ...recordQuery(a.experiment ?? ''), enabled: !!a.experiment }).data;
  return (
    <div className="crumbs">
      lab / library / <Link to="/layouts">plate layouts</Link> /{' '}
      <Link to="/records/$id" params={{ id: a.layout.id }}>
        {layout?.label ?? 'layout'}
      </Link>{' '}
      →{' '}
      <b>
        {a.experiment ? (
          <>
            for{' '}
            <Link to="/records/$id" params={{ id: a.experiment }}>
              {experiment?.name ?? 'its experiment'}
            </Link>
          </>
        ) : (
          (a.purpose ?? record.name)
        )}
      </b>
    </div>
  );
}

/** The record's own picture and the blocks its kind adds, shown on the Overview. */
function KindBlocks({ record: r }: { record: RecordEnvelope }) {
  return (
    <>
      {r.kind === 'labware_type' && (
        <>
          <LabwareDrawing attributes={r.attributes} />
          <OpentronsBlock record={r} />
        </>
      )}
      {(r.kind === 'lot' || r.kind === 'sample' || r.kind === 'product') && (
        <WhereIsBlock record={r} />
      )}
      {r.kind === 'instrument' && <InstrumentBlocks record={r} />}
      {r.kind === 'workcell' && <WorkcellBlocks record={r} />}
      {r.kind === 'product' && <ProductBlocks record={r} />}
      {r.kind === 'liquid_class' && <LiquidClassBlocks record={r} />}
      {r.kind === 'campaign' && <CampaignBlocks record={r} />}
      {r.kind === 'experiment' && <ExperimentBlocks record={r} />}
      {r.kind === 'assay_template' && <AssayTemplateBlocks record={r} />}
      {r.kind === 'layout' && <LayoutBlocks record={r} />}
      {r.kind === 'plate_map' && <PlateMapBlocks record={r} />}
      {r.kind === 'run' && <RunBlocks record={r} />}
      {r.kind === 'set' && <SetBlocks record={r} />}
      {r.kind === 'container' && <ContainerBlocks record={r} />}
      {r.kind === 'entity' && <EntityBlocks record={r} />}
      {r.kind === 'document' && <DocumentBlocks record={r} />}
    </>
  );
}

/** "Tube, 1.5 mL · in Freezer -20 1 · in use", each linked part opening its record. */
function Identity({ parts, fallback }: { parts: OverviewPart[] | undefined; fallback: string }) {
  const shown = parts ?? [{ text: fallback[0]?.toUpperCase() + fallback.slice(1) }];
  return (
    <p className="identity">
      {shown.map((p, i) => (
        <Fragment key={`${p.text}-${p.record ?? ''}`}>
          {i > 0 && ' · '}
          {p.record ? (
            <Link to="/records/$id" params={{ id: p.record }} className="ref">
              {p.text}
            </Link>
          ) : (
            p.text
          )}
        </Fragment>
      ))}
    </p>
  );
}

/** The few facts a person needs first, chosen per kind by the API (N4); unsourced ones marked (N7). */
function KeyFacts({ facts, marked }: { facts: OverviewFact[]; marked: Set<string> }) {
  return (
    <section className="block" aria-label="Key facts">
      <div className="body">
        <dl className="facts">
          {facts.map((f) => (
            <div key={`${f.label}-${f.value}`} className="fact">
              <dt>{f.label}</dt>
              <dd
                className={
                  f.tone === 'crit' ? 'crit-ink' : f.tone === 'warn' ? 'warn-ink' : undefined
                }
              >
                {f.record ? (
                  <Link to="/records/$id" params={{ id: f.record }} className="ref">
                    {f.value}
                  </Link>
                ) : (
                  f.value
                )}
                {f.field && marked.has(f.field) && (
                  <span className="unsourced" title="entered by an agent, no source given">
                    ◦
                  </span>
                )}
                {f.detail && <small>{f.detail}</small>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** Top-level fields holding a value an agent gave with no source, confirmed or not. */
function unsourcedFields(record: RecordEnvelope, readiness: Readiness | undefined): Set<string> {
  const fields = new Set<string>();
  for (const path of readiness?.assumed ?? []) {
    fields.add(path.startsWith('/') ? (path.split('/')[1] ?? path) : path);
  }
  for (const [field, e] of Object.entries(record.evidence)) {
    if (!field.startsWith('/') && e.source === 'assumed' && e.by.type === 'agent')
      fields.add(field);
  }
  return fields;
}

/** A record that isn't there: a mistyped code, another lab's record, or one that was discarded. */
function RecordMissing({ id, error }: { id: string; error: Error }) {
  const missing = (error as { code?: string }).code === 'not_found';
  return (
    <div className="record-page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <Link to="/records">records</Link>
          </div>
          <h1>{missing ? 'No such record' : 'This record can’t be shown'}</h1>
          <p className="lede">
            {missing
              ? `Nothing in this lab has the code ${id}. It may have been a draft that was discarded, or a record of another lab.`
              : error.message}
          </p>
        </div>
      </div>
      <p>
        <Link to="/records">Find it in all records</Link>
      </p>
    </div>
  );
}

/** Every version: who changed what, when and why, with Restore. */
/** What a physical event did, as the History tab says it. */
const EVENT_WORDS: Record<InventoryEvent['type'], string> = {
  fill: 'filled',
  transfer: 'transferred',
  stamp: 'stamped',
  consume: 'used',
  correct: 'corrected',
  discard: 'discarded',
};

/**
 * One timeline (plan 004f-2): every version of the record and, for a container, every physical
 * event in its ledger (fills, transfers, use, corrections), newest first.
 */
function History({
  record: r,
  versions,
  ledger,
}: {
  record: RecordEnvelope;
  versions: RecordVersion[];
  ledger: InventoryEvent[];
}) {
  const me = useMe();
  const rows: { at: string; key: string; version?: RecordVersion; event?: InventoryEvent }[] = [
    ...versions.map((v) => ({ at: v.at, key: `v${v.version}`, version: v })),
    ...ledger.map((e) => ({ at: e.at, key: e.id, event: e })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <section className="block" aria-label="History">
      <div className="body">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Who</th>
                <th>Version</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const actor = row.version?.actor ?? row.event?.actor;
                return (
                  <tr key={row.key}>
                    <td className="when">{formatWhen(row.at)}</td>
                    <td>
                      {row.version ? (
                        <VersionWords versions={versions} v={row.version} />
                      ) : row.event ? (
                        <EventWords event={row.event} container={r.id} />
                      ) : null}
                    </td>
                    <td className={actor && isAgent(actor) ? 'agent-ink' : undefined}>
                      {actor ? actorLabel(actor, me) : ''}
                    </td>
                    <td className="q">{row.version ? `v${row.version.version}` : ''}</td>
                    <td>
                      {row.version && <RestoreVersion record={r} version={row.version.version} />}
                    </td>
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

/** A version's change in words: the operation, the sections confirmed, the fields changed, why. */
function VersionWords({ versions, v }: { versions: RecordVersion[]; v: RecordVersion }) {
  const previous = versions.find((p) => p.version === v.version - 1)?.snapshot;
  const changed = diffRecords(previous, v.snapshot).map((c) => c.field);
  return (
    <>
      {v.via && !v.via.startsWith('records.')
        ? operationVerb(v.via)
        : (operationWords[v.operation] ?? v.operation)}
      {v.operation === 'confirm_section' && (
        <span> {confirmedSections(previous, v.snapshot).join(', ')}</span>
      )}
      {v.operation === 'confirm_section' &&
        previous?.status === 'draft' &&
        v.snapshot.status === 'active' && <span> and activated</span>}
      {v.operation !== 'create' && changed.length > 0 && (
        <span className="muted"> ({changed.join(', ')})</span>
      )}
      {v.reason && <span className="muted"> · “{v.reason}”</span>}
    </>
  );
}

/** A physical event in words: what happened to how many of this container's wells, and why. */
function EventWords({ event, container }: { event: InventoryEvent; container: string }) {
  const wells = new Set(event.lines.filter((l) => l.container === container).map((l) => l.well));
  return (
    <>
      {EVENT_WORDS[event.type]} {wells.size} {wells.size === 1 ? 'well' : 'wells'}
      {event.reason && <span className="muted"> · “{event.reason}”</span>}
    </>
  );
}

/**
 * Fields a kind shows in its lab form rather than as a table (UI rule 1). Everything else goes
 * through the shared value renderer, which already names records and lists items as tables.
 */
const fieldViews: Record<string, (value: unknown, record: RecordEnvelope) => ReactNode> = {
  'instrument/configuration': (value) => (
    <InstalledEquipment configuration={value as Configuration | undefined} />
  ),
  'lot/values': (_, record) => <LotValues record={record} />,
};

/** The sections a confirmation added or refreshed, by their ID. */
function confirmedSections(
  before: { reviews?: Record<string, { confirmedAt: string }> } | undefined,
  after: { reviews?: Record<string, { confirmedAt: string }> },
): string[] {
  return Object.entries(after.reviews ?? {})
    .filter(([id, review]) => before?.reviews?.[id]?.confirmedAt !== review.confirmedAt)
    .map(([id]) => fieldLabel(id));
}

/**
 * A lot's certificate values by the names its product gives them ("Working concentration 0.5 mg/mL"),
 * not by their keys (QA 2026-10-01 Q6).
 */
function LotValues({ record }: { record: RecordEnvelope }) {
  const a = record.attributes as { product?: string; values?: { field: string; value: unknown }[] };
  const product = useQuery({ ...recordQuery(a.product ?? ''), enabled: !!a.product }).data;
  const fields = (product?.attributes.lotFields ?? []) as { key: string; label: string }[];
  return (
    <>
      {(a.values ?? []).map((v) => (
        <div key={v.field}>
          {fields.find((f) => f.key === v.field)?.label ?? fieldLabel(v.field)}{' '}
          <span className="num">{formatValue(v.value)}</span>
        </div>
      ))}
    </>
  );
}

/**
 * What the record is based on and what uses it, in two columns (N6). Relation words and dates come
 * in 004f-2; until then each link names its relation.
 */
/**
 * Connections (plan 004f N6): what the record is based on and where it is used, grouped by the
 * relation in words, each record by name with its code as a tag and when it last changed.
 */
function Connections({ from, to }: { from: Connection[]; to: Connection[] }) {
  return (
    <section className="block" aria-label="Connections">
      <div className="body connection-columns">
        <ConnectionColumn title="Based on" links={from} empty="Not based on another record." />
        <ConnectionColumn title="Used in" links={to} empty="Not used in another record yet." />
      </div>
    </section>
  );
}

/** Links shown per relation before the rest fold under "N more". */
const SHOWN_PER_RELATION = 6;

function ConnectionColumn({
  title,
  links,
  empty,
}: {
  title: string;
  links: Connection[];
  empty: string;
}) {
  const groups = new Map<string, Connection[]>();
  for (const link of links) groups.set(link.words, [...(groups.get(link.words) ?? []), link]);
  return (
    <section aria-label={title}>
      <h3 className="column-title">{title}</h3>
      {links.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        [...groups].map(([words, group]) => (
          <ConnectionGroup key={words} words={words} links={group} />
        ))
      )}
    </section>
  );
}

function ConnectionGroup({ words, links }: { words: string; links: Connection[] }) {
  const [open, setOpen] = useState(false);
  const sorted = [...links].sort((a, b) => b.other.updatedAt.localeCompare(a.other.updatedAt));
  const shown = open ? sorted : sorted.slice(0, SHOWN_PER_RELATION);
  return (
    <div className="connection-group">
      <h4 className="relation-words">
        {words}
        {links.length > 1 && <span className="relation-count"> {links.length}</span>}
      </h4>
      <ul className="plain connections">
        {shown.map(({ other }) => (
          <li key={other.id}>
            <Link to="/records/$id" params={{ id: other.id }} className="linked-name">
              {other.label} <span className="code">{other.name}</span>
            </Link>
            {other.status !== 'active' && <span className="muted"> · {other.status}</span>}
            <span className="when" title={`last changed ${formatWhen(other.updatedAt)}`}>
              {formatShortDay(other.updatedAt)}
            </span>
          </li>
        ))}
      </ul>
      {sorted.length > shown.length && (
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          {sorted.length - shown.length} more
        </button>
      )}
    </div>
  );
}
