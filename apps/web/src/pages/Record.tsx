import type { RecordLink } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import {
  actorLabel,
  diffRecords,
  formatValue,
  formatWhen,
  isAgent,
  isQuantity,
} from '../lib/format.ts';
import { kindNoun, kindPage } from '../lib/kinds.ts';
import {
  historyQuery,
  kindsQuery,
  linksQuery,
  pendingProposalsQuery,
  readinessQuery,
  recordQuery,
} from '../queries.ts';
import { useMe } from '../session.ts';
import { DocumentBlocks } from './Documents.tsx';
import type { JsonSchema } from './FieldEditor.tsx';
import { InstrumentBlocks } from './Instruments.tsx';
import { ContainerBlocks, EntityBlocks, WhereIsBlock } from './Inventory.tsx';
import { LabwareDrawing } from './LabwareDrawing.tsx';
import { MentionedIn } from './Mentions.tsx';
import { OpentronsBlock } from './OpentronsBlock.tsx';
import { LiquidClassBlocks, ProductBlocks } from './Reagents.tsx';
import { fieldLabel, ReviewBlocks } from './RecordReview.tsx';
import { SectionEditor } from './SectionEditor.tsx';
import { SopBlocks } from './Sops.tsx';
import { StatusChip } from './StatusChip.tsx';

const operationWords: Record<string, string> = {
  create: 'created',
  update: 'edited',
  activate: 'confirmed and activated',
  confirm_section: 'confirmed',
  archive: 'archived',
  unarchive: 'unarchived',
  restore: 'restored an earlier version',
};

/** One record: its fields, full history (who changed what and why) and where it is used. */
export function RecordPage() {
  const { id } = useParams({ from: '/app/records/$id' });
  const record = useQuery(recordQuery(id));
  const history = useQuery(historyQuery(id));
  const readiness = useQuery(readinessQuery(id)).data;
  const pending = (useQuery(pendingProposalsQuery).data ?? []).filter(
    (p) => (p.input as { id?: unknown } | undefined)?.id === id,
  );
  const me = useMe();
  const kinds = useQuery(kindsQuery).data;
  const [editing, setEditing] = useState(false);

  if (record.error) {
    return <p className="error-text">{record.error.message}</p>;
  }
  const r = record.data;
  if (!r) return <p className="empty">Loading…</p>;
  const versions = [...(history.data ?? [])].sort((a, b) => b.version - a.version);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab /{' '}
            {kindPage(r.kind) ? (
              <Link to={kindPage(r.kind)?.path ?? '/records'}>
                {kindPage(r.kind)?.title.toLowerCase()}
              </Link>
            ) : (
              <Link to="/records">records</Link>
            )}{' '}
            / <b>{r.name}</b>
          </div>
          <h1>
            <span className="mono">{r.name}</span> {r.label}
          </h1>
          <p className="lede">
            {kindNoun(r.kind)} · version {r.version} · changed {formatWhen(r.updatedAt)} by{' '}
            <span className={isAgent(r.updatedBy) ? 'agent-ink' : undefined}>
              {actorLabel(r.updatedBy, me)}
            </span>
          </p>
        </div>
        <StatusChip record={r} />
      </div>

      {pending.length > 0 && (
        <p className="agent-ink">
          {pending.length === 1
            ? 'An agent has proposed a change'
            : `Agents have proposed ${pending.length} changes`}{' '}
          to this record. <Link to="/review">Review it</Link>
        </p>
      )}

      {(r.kind === 'lot' || r.kind === 'sample' || r.kind === 'product') && (
        <WhereIsBlock record={r} />
      )}

      {readiness && readiness.sections.length > 0 ? (
        <ReviewBlocks
          record={r}
          readiness={readiness}
          renderValue={renderValue}
          aside={
            r.kind === 'labware_type' ? (
              <>
                <LabwareDrawing attributes={r.attributes} />
                <OpentronsBlock record={r} />
              </>
            ) : r.kind === 'instrument' ? (
              <InstrumentBlocks record={r} />
            ) : r.kind === 'product' ? (
              <ProductBlocks record={r} />
            ) : r.kind === 'liquid_class' ? (
              <LiquidClassBlocks record={r} />
            ) : r.kind === 'sop' ? (
              <SopBlocks record={r} />
            ) : undefined
          }
        />
      ) : (
        <section className="block">
          <header>
            <h2>Fields</h2>
          </header>
          <div className="body">
            {editing ? (
              <SectionEditor
                record={r}
                fields={Object.keys(
                  (kinds?.find((k) => k.kind === r.kind)?.attributes as JsonSchema | undefined)
                    ?.properties ?? r.attributes,
                )}
                onDone={() => setEditing(false)}
              />
            ) : Object.keys(r.attributes).length === 0 ? (
              <p className="empty">No fields.</p>
            ) : (
              <dl className="kv">
                {Object.entries(r.attributes).map(([key, value]) => (
                  <Field key={key} name={key} value={value} />
                ))}
              </dl>
            )}
            {!editing && r.status !== 'archived' && (
              <div className="actions">
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  Edit fields
                </button>
              </div>
            )}
            <details className="tech">
              <summary>technical details</summary>
              <pre className="json">{JSON.stringify(r, null, 2)}</pre>
            </details>
          </div>
        </section>
      )}

      {r.kind === 'container' && <ContainerBlocks record={r} />}
      {r.kind === 'entity' && <EntityBlocks record={r} />}
      {r.kind === 'document' && <DocumentBlocks record={r} />}
      {r.kind !== 'document' && <MentionedIn record={r} />}

      <section className="block">
        <header>
          <h2>History</h2>
          <span className="state muted num">{versions.length} versions</span>
        </header>
        <div className="body">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>When</th>
                  <th>Who</th>
                  <th>What changed</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const previous = versions.find((p) => p.version === v.version - 1)?.snapshot;
                  const changed = diffRecords(previous, v.snapshot).map((c) => c.field);
                  return (
                    <tr key={v.version}>
                      <td className="q">v{v.version}</td>
                      <td className="when">{formatWhen(v.at)}</td>
                      <td className={isAgent(v.actor) ? 'agent-ink' : undefined}>
                        {actorLabel(v.actor, me)}
                      </td>
                      <td>
                        {operationWords[v.operation] ?? v.operation}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Links id={id} />
    </>
  );
}

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
 * A value as a person reads it: linked records by name, quantities with their unit, and a list of
 * objects (an SOP's variables or steps) as a small table, one row per item.
 */
function renderValue(value: unknown): ReactNode {
  const isRef = typeof value === 'string' && /^[a-z]{2,5}_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
  if (isRef) return <LinkedName id={value as string} />;
  if (Array.isArray(value) && value.length > 0 && value.every(isPlainObject))
    return <ItemsTable items={value as Record<string, unknown>[]} />;
  return formatValue(value);
}

const isPlainObject = (v: unknown) =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !isQuantity(v);

function ItemsTable({ items }: { items: Record<string, unknown>[] }) {
  // Columns in the order the items use them; source quotes stay on the record's history.
  const columns = [...new Set(items.flatMap((item) => Object.keys(item)))].filter(
    (key) => key !== 'cite',
  );
  return (
    <table className="items-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c}>{fieldLabel(c)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={JSON.stringify(item)}>
            {columns.map((c) => (
              <td key={c}>{item[c] === undefined ? '' : renderValue(item[c])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Field({ name, value }: { name: string; value: unknown }) {
  return (
    <>
      <dt>{fieldLabel(name)}</dt>
      <dd className="mono">{renderValue(value)}</dd>
    </>
  );
}

function Links({ id }: { id: string }) {
  const from = useQuery(linksQuery(id, 'from')).data ?? [];
  const to = useQuery(linksQuery(id, 'to')).data ?? [];
  if (from.length === 0 && to.length === 0) return null;
  const row = (link: RecordLink, other: string, direction: string) => (
    <tr key={`${direction}-${link.fromId}-${link.toId}-${link.relation}`}>
      <td className="muted">{direction}</td>
      <td className="mono">{link.relation.replaceAll('_', ' ')}</td>
      <td>
        <LinkedName id={other} />
      </td>
    </tr>
  );
  return (
    <section className="block">
      <header>
        <h2>Links</h2>
      </header>
      <div className="body">
        <div className="table-wrap">
          <table>
            <tbody>
              {from.map((l) => row(l, l.toId, 'points to'))}
              {to.map((l) => row(l, l.fromId, 'used by'))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function LinkedName({ id }: { id: string }) {
  const { data } = useQuery(recordQuery(id));
  return (
    <Link to="/records/$id" params={{ id }} className="mono">
      {data ? `${data.name} ${data.label}` : id}
    </Link>
  );
}
