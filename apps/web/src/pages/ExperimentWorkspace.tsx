import { formatQuantity, parseWellName } from '@ailab/domain';
import type {
  ExperimentAttributes,
  Readiness,
  RecordEnvelope,
  WorkspaceProjection,
  WorkspaceRecordSummary,
  WorkspaceView,
} from '@ailab/schema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAssistant } from '../assistant.tsx';
import { describeWell, roleClass, roleText } from '../lib/platemaps.ts';
import {
  parseWorkspace,
  workspaceHref,
  workspaceQuery,
  workspaceSearch,
} from '../lib/workspace.ts';
import { recordQuery } from '../queries.ts';
import { AllFields } from './AllFields.tsx';
import { ReadinessBlock } from './RecordReview.tsx';
import { renderValue } from './Value.tsx';

type Page = { offset: number; limit: number; total: number; hasMore: boolean; items: unknown[] };
export function WorkspacePager({
  page,
  onPage,
  label,
}: {
  page: Page;
  onPage: (page: { offset: number; limit: number }) => void;
  label: string;
}) {
  return (
    <nav className="actions workspace-pager" aria-label={`${label} pages`}>
      <button
        className="btn"
        type="button"
        disabled={page.offset === 0}
        onClick={() => onPage({ offset: Math.max(0, page.offset - page.limit), limit: page.limit })}
      >
        Previous
      </button>
      <span>
        {page.items.length ? `${page.offset + 1}–${page.offset + page.items.length}` : '0 shown'} of{' '}
        {page.total}
      </span>
      <button
        className="btn"
        type="button"
        disabled={!page.hasMore}
        onClick={() => onPage({ offset: page.offset + page.limit, limit: page.limit })}
      >
        Next
      </button>
    </nav>
  );
}
export function ExperimentWorkspace({
  record,
  readiness,
  editing,
  onEdit,
  onDetails,
}: {
  record: RecordEnvelope;
  readiness: Readiness | undefined;
  editing: string | undefined;
  onEdit: (part: string | undefined) => void;
  onDetails: () => void;
}) {
  const location = useRouterState({ select: (state) => state.location });
  const parsed = parseWorkspace(location.search);
  const view: WorkspaceView = parsed.view ?? { panel: 'design' };
  const query = useQuery({
    ...workspaceQuery(record.id, view, parsed.version),
    enabled: !parsed.error,
  });
  const navigate = useNavigate();
  const assistant = useAssistant();
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSection, setEditorSection] = useState('question');
  const data = query.data?.selection.version === record.version ? query.data : undefined;
  const map = view.panel === 'plates' ? view.map : undefined;
  const mapData = data?.panel === 'plates' ? data.selectedMap : undefined;
  const plan = view.panel === 'transfers' ? view.plan : undefined;
  const planData = data?.panel === 'transfers' ? data.selectedPlan : undefined;
  useEffect(() => {
    if (data && !query.isFetching && !query.error && !parsed.error && parsed.version === undefined)
      void navigate({
        to: '/records/$id',
        params: { id: record.id },
        search: workspaceSearch(data.selection),
        replace: true,
      });
  }, [data, query.isFetching, query.error, parsed.error, parsed.version, record.id, navigate]);
  // Only the exact, successfully revalidated view is conversational context.
  useEffect(() => {
    assistant.setWorkspace(
      query.isFetching || query.error || parsed.error ? undefined : data?.selection,
    );
    return () => assistant.setWorkspace(undefined);
  }, [assistant.setWorkspace, data, query.isFetching, query.error, parsed.error]);
  const open = (
    next: WorkspaceView,
    version = data?.selection.version ?? parsed.version ?? record.version,
  ) =>
    void navigate({
      to: '/records/$id',
      params: { id: record.id },
      search: workspaceSearch({ experiment: record.id, version, view: next }),
    });
  const detail = (item: WorkspaceRecordSummary) =>
    open({ ...view, detail: { id: item.id, version: item.version } });
  const refreshCurrent = async () => {
    try {
      const current = await queryClient.fetchQuery(recordQuery(record.id));
      setRefreshError(undefined);
      open({ panel: view.panel }, current.version);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Could not refresh this experiment');
    }
  };
  return (
    <div className="experiment-workspace">
      <nav className="tabs" aria-label="Experiment workspace">
        {(['design', 'plates', 'transfers'] as const).map((panel) => (
          <Link
            key={panel}
            to="/records/$id"
            params={{ id: record.id }}
            search={workspaceSearch({
              experiment: record.id,
              version: data?.selection.version ?? parsed.version ?? record.version,
              view: { panel },
            })}
            className={view.panel === panel ? 'tab on' : 'tab'}
            aria-current={view.panel === panel ? 'page' : undefined}
          >
            {panel[0]?.toUpperCase()}
            {panel.slice(1)}
          </Link>
        ))}
        <Link
          to="/records/$id"
          params={{ id: record.id }}
          search={{ tab: 'overview' }}
          className="tab"
        >
          Record details
        </Link>
      </nav>
      {parsed.error ? (
        <p className="error-text" role="alert">
          {parsed.error}
        </p>
      ) : query.error || (query.data && query.data.selection.version !== record.version) ? (
        <p className="error-text" role="alert">
          {query.error?.message ??
            'The experiment changed while this view was loading. Refresh the current view to continue.'}{' '}
          <button type="button" className="btn" onClick={() => void refreshCurrent()}>
            Refresh current view
          </button>
        </p>
      ) : !data && query.isFetching ? (
        <p className="empty">Loading saved view…</p>
      ) : data ? (
        <>
          <section
            className={`block workspace-question${data.panel === 'design' ? '' : ' compact'}`}
          >
            <div className="body">
              <p className="muted">
                {data.campaign.label} <span className="code">{data.campaign.name}</span>
              </p>
              <h2>{data.experiment.question || 'No question recorded yet'}</h2>
              <p>
                {data.experiment.subjectCount} materials or collections ·{' '}
                {data.experiment.stage.replaceAll('_', ' ')}
              </p>
            </div>
          </section>
          <div className={`workspace-columns${data.detail ? ' with-detail' : ''}`}>
            <div className="workspace-content">
              {data.panel === 'design' && (
                <>
                  <section className="block">
                    <header>
                      <h2>Saved design</h2>
                    </header>
                    <div className="body">
                      <SavedDesign record={record} onDetails={onDetails} />
                      <p>
                        {data.experiment.summary ??
                          'Review the experiment’s saved materials and protocol below.'}
                      </p>
                      <Related
                        data={data.related}
                        onDetail={detail}
                        onPage={(page) => open({ ...view, page })}
                      />
                    </div>
                  </section>
                  {readiness && (record.status === 'draft' || !readiness.ready) && (
                    <ReadinessBlock
                      record={record}
                      readiness={readiness}
                      titles={Object.fromEntries(
                        readiness.sections.map((part) => [part.id, part.title]),
                      )}
                      onFix={(section) => {
                        if (section === 'subjects') onDetails();
                        else {
                          setEditorSection(section);
                          onEdit(section);
                        }
                      }}
                      editing={editing}
                    />
                  )}
                </>
              )}
              {data.panel === 'plates' && (
                <>
                  <section className="block">
                    <header>
                      <h2>Plate maps</h2>
                      <span>{data.maps.total} saved</span>
                    </header>
                    <div className="body">
                      <RecordChoices
                        records={data.maps.items}
                        selected={mapData?.record.id}
                        onSelect={(item) =>
                          open({
                            panel: 'plates',
                            page: view.page,
                            map: { id: item.id, version: item.version, plate: 1 },
                          })
                        }
                      />
                      <WorkspacePager
                        page={data.maps}
                        label="Plate maps"
                        onPage={(page) => open({ ...view, page })}
                      />
                    </div>
                  </section>
                  {mapData && view.panel === 'plates' && map && (
                    <section className="block">
                      <header>
                        <h2>{mapData.record.label}</h2>
                        <FullRecord record={mapData.record} selection={data.selection} />
                      </header>
                      <div className="body">
                        <div className="actions">
                          <button
                            className="btn"
                            type="button"
                            disabled={mapData.plate <= 1}
                            onClick={() =>
                              open({
                                ...view,
                                map: {
                                  ...map,
                                  plate: mapData.plate - 1,
                                  wells: undefined,
                                },
                                detail: undefined,
                              })
                            }
                          >
                            Previous plate
                          </button>
                          <span>
                            Plate {mapData.plate} of {mapData.plateCount}
                          </span>
                          <button
                            className="btn"
                            type="button"
                            disabled={mapData.plate >= mapData.plateCount}
                            onClick={() =>
                              open({
                                ...view,
                                map: {
                                  ...map,
                                  plate: mapData.plate + 1,
                                  wells: undefined,
                                },
                                detail: undefined,
                              })
                            }
                          >
                            Next plate
                          </button>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const number = Number(new FormData(event.currentTarget).get('plate'));
                              if (number >= 1 && number <= mapData.plateCount)
                                open({
                                  ...view,
                                  map: { ...map, plate: number, wells: undefined },
                                  detail: undefined,
                                });
                            }}
                          >
                            <label>
                              Go to plate{' '}
                              <input
                                aria-label="Go to plate"
                                name="plate"
                                type="number"
                                min="1"
                                max={mapData.plateCount}
                                required
                              />
                            </label>
                            <button className="btn" type="submit">
                              Go
                            </button>
                          </form>
                        </div>
                        <fieldset
                          className="workspace-wells"
                          style={{
                            gridTemplateColumns: `repeat(${Math.max(...mapData.wells.map((well) => Number(well.well.match(/\d+$/)?.[0] ?? 1)))}, minmax(30px, 1fr))`,
                          }}
                          aria-label="Saved plate wells"
                        >
                          {mapData.wells.map((well) => (
                            <button
                              type="button"
                              key={well.well}
                              style={{
                                gridColumn: parseWellName(well.well).column + 1,
                                gridRow: parseWellName(well.well).row + 1,
                              }}
                              className={`workspace-well ${roleClass(well.role)}${map.wells?.includes(well.well) ? ' chosen' : ''}`}
                              aria-pressed={map.wells?.includes(well.well) ?? false}
                              aria-label={`${well.well}: ${describeWell(well)}`}
                              onClick={() => open({ ...view, map: { ...map, wells: [well.well] } })}
                            >
                              {well.well}
                            </button>
                          ))}
                        </fieldset>
                        {mapData.wells
                          .filter((well) => map.wells?.includes(well.well))
                          .map((well) => (
                            <div key={well.well} className="well-detail">
                              <h3>
                                {well.well}: {roleText(well.role)}
                              </h3>
                              <p>{describeWell(well)}</p>
                              {well.override && <p className="muted">Changed by hand</p>}
                            </div>
                          ))}
                        <h3>Materials and layout</h3>
                        <Related
                          data={mapData.related}
                          onDetail={detail}
                          onPage={(relatedPage) => open({ ...view, map: { ...map, relatedPage } })}
                        />
                      </div>
                    </section>
                  )}
                </>
              )}
              {data.panel === 'transfers' && (
                <>
                  <section className="block">
                    <header>
                      <h2>Transfer plans</h2>
                      <span>{data.plans.total} saved</span>
                    </header>
                    <div className="body">
                      <RecordChoices
                        records={data.plans.items}
                        selected={planData?.record.id}
                        onSelect={(item) =>
                          open({
                            panel: 'transfers',
                            page: view.page,
                            plan: { id: item.id, version: item.version },
                          })
                        }
                      />
                      <WorkspacePager
                        page={data.plans}
                        label="Transfer plans"
                        onPage={(page) => open({ ...view, page })}
                      />
                    </div>
                  </section>
                  {planData && view.panel === 'transfers' && plan && (
                    <section className="block">
                      <header>
                        <h2>{planData.record.label}</h2>
                        <FullRecord record={planData.record} selection={data.selection} />
                      </header>
                      <div className="body">
                        <h3>Transfer groups</h3>
                        <ul className="plain workspace-choices">
                          {planData.groups.items.map((group) => (
                            <li key={group.id}>
                              <button
                                className="btn"
                                type="button"
                                aria-pressed={plan.group === group.id}
                                onClick={() =>
                                  open({
                                    ...view,
                                    plan: {
                                      ...plan,
                                      group: group.id,
                                      rowsPage: undefined,
                                      relatedPage: undefined,
                                    },
                                    detail: undefined,
                                  })
                                }
                              >
                                {group.label}
                              </button>{' '}
                              <span>
                                {group.transferCount} transfers ·{' '}
                                {group.device?.label ??
                                  (group.instrument ? 'Instrument details below' : 'By hand')}
                              </span>
                              <p className="muted">{group.reason}</p>
                            </li>
                          ))}
                        </ul>
                        <WorkspacePager
                          page={planData.groups}
                          label="Transfer groups"
                          onPage={(groupsPage) => open({ ...view, plan: { ...plan, groupsPage } })}
                        />
                        {planData.selectedGroup && (
                          <>
                            <h3>{planData.selectedGroup.group.label}: saved worklist</h3>
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Row</th>
                                    <th>Source</th>
                                    <th>Destination</th>
                                    <th>Volume</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {planData.selectedGroup.rows.items.map((row) => (
                                    <tr key={row.index}>
                                      <td>{row.index + 1}</td>
                                      <td>
                                        {row.source.label ?? row.source.id} ·{' '}
                                        {row.transfer.from.well}
                                      </td>
                                      <td>
                                        {row.destination.label ?? row.destination.id} ·{' '}
                                        {row.transfer.to.well}
                                      </td>
                                      <td>{formatQuantity(row.transfer.volume)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <WorkspacePager
                              page={planData.selectedGroup.rows}
                              label="Worklist rows"
                              onPage={(rowsPage) => open({ ...view, plan: { ...plan, rowsPage } })}
                            />
                            <p className="muted">
                              Saved transfers. Open the full plan for checks, editing and export.
                            </p>
                          </>
                        )}
                        <h3>Sources, labware and instruments</h3>
                        <Related
                          data={planData.related}
                          onDetail={detail}
                          onPage={(relatedPage) =>
                            open({ ...view, plan: { ...plan, relatedPage } })
                          }
                        />
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
            {data.detail && (
              <WorkspaceDetail data={data} onClose={() => open({ ...view, detail: undefined })} />
            )}
          </div>
        </>
      ) : null}
      {refreshError && (
        <p className="error-text" role="alert">
          {refreshError}
        </p>
      )}
      {view.panel === 'design' && readiness && (
        <details
          open={Boolean(editing) || editorOpen}
          onToggle={(event) => {
            if (editing && !event.currentTarget.open) event.currentTarget.open = true;
            else setEditorOpen(event.currentTarget.open);
          }}
          className="workspace-editor"
        >
          <summary>Edit saved design</summary>
          {(editorOpen || editing) && (
            <>
              <nav className="actions" aria-label="Choose a design section">
                {readiness.sections
                  .filter((section) => section.id !== 'subjects')
                  .map((section) => (
                    <button
                      key={section.id}
                      className="btn"
                      type="button"
                      disabled={Boolean(editing) && editing !== section.id}
                      aria-pressed={(editing ?? editorSection) === section.id}
                      onClick={() => setEditorSection(section.id)}
                    >
                      {section.title}
                    </button>
                  ))}
                <button
                  type="button"
                  className="btn"
                  disabled={Boolean(editing)}
                  onClick={onDetails}
                >
                  Materials and all design details
                </button>
              </nav>
              {(editing ?? editorSection) !== 'subjects' && (
                <AllFields
                  record={record}
                  readiness={readiness}
                  renderValue={renderValue}
                  editing={editing}
                  onEdit={onEdit}
                  onlySection={editing ?? editorSection}
                  onSaved={(updated) => {
                    flushSync(() => onEdit(undefined));
                    queryClient.setQueryData(recordQuery(updated.id).queryKey, updated);
                    open(view, updated.version);
                  }}
                />
              )}
            </>
          )}
        </details>
      )}
    </div>
  );
}
function RecordChoices({
  records,
  selected,
  onSelect,
}: {
  records: WorkspaceRecordSummary[];
  selected?: string | undefined;
  onSelect: (item: WorkspaceRecordSummary) => void;
}) {
  return records.length ? (
    <ul className="plain workspace-choices">
      {records.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="btn"
            aria-pressed={selected === item.id}
            onClick={() => onSelect(item)}
          >
            {item.label} <span className="code">{item.name}</span>
          </button>{' '}
          <span className="muted">{item.status === 'active' ? 'confirmed' : item.status}</span>
          {item.summary && <p>{item.summary}</p>}
        </li>
      ))}
    </ul>
  ) : (
    <p className="empty">No saved items on this page.</p>
  );
}
function SavedDesign({ record, onDetails }: { record: RecordEnvelope; onDetails: () => void }) {
  const attributes = record.attributes as ExperimentAttributes;
  const sections = [
    { title: 'Conditions', field: 'conditions', items: attributes.conditions ?? [] },
    { title: 'Controls', field: 'controls', items: attributes.controls ?? [] },
    { title: 'Readouts', field: 'readouts', items: attributes.readouts ?? [] },
  ];
  return (
    <>
      {sections.map((section) => (
        <div key={section.title}>
          <h3>{section.title}</h3>
          {section.items.length ? (
            <>
              <p
                className={
                  record.evidence[section.field]?.source === 'assumed' ||
                  record.evidence[section.field]?.source === 'stated'
                    ? 'agent-ink'
                    : 'muted'
                }
              >
                {record.evidence[section.field]?.source.replaceAll('_', ' ') ?? 'Source unknown'}
                {record.evidence[section.field]?.note &&
                  ` · ${record.evidence[section.field]?.note}`}
              </p>
              <ul className="plain">
                {section.items.slice(0, 20).map((item) => (
                  <li key={item.id}>
                    <b>{item.label}</b>
                    {'role' in item && ` · ${item.role}`}
                    {item.text && <p>{item.text}</p>}
                  </li>
                ))}
              </ul>
              {section.items.length > 20 && (
                <p>
                  {section.items.length - 20} more saved entries.{' '}
                  <button type="button" className="btn" onClick={onDetails}>
                    Open design details
                  </button>
                </p>
              )}
            </>
          ) : (
            <p className="muted">Not recorded yet.</p>
          )}
        </div>
      ))}
    </>
  );
}
function Related({
  data,
  onDetail,
  onPage,
}: {
  data: Extract<WorkspaceProjection, { panel: 'design' }>['related'];
  onDetail: (item: WorkspaceRecordSummary) => void;
  onPage: (page: { offset: number; limit: number }) => void;
}) {
  return (
    <>
      <ul className="plain workspace-choices">
        {data.items.map((item) => (
          <li key={`${item.relation}-${item.record.id}-${item.record.version}`}>
            <span className="muted">
              {item.relation === 'subject' ? 'material' : item.relation.replaceAll('_', ' ')} ·{' '}
            </span>
            <button type="button" className="btn" onClick={() => onDetail(item.record)}>
              {item.record.label} <span className="code">{item.record.name}</span>
            </button>
            <span className="muted">
              {' '}
              · {item.pinned ? `saved version ${item.record.version}` : 'current record'}
            </span>
            {item.record.summary && <p>{item.record.summary}</p>}
          </li>
        ))}
      </ul>
      <WorkspacePager page={data} label="Materials and methods" onPage={onPage} />
    </>
  );
}
function FullRecord({
  record,
  selection,
}: {
  record: WorkspaceRecordSummary;
  selection: WorkspaceProjection['selection'];
}) {
  return (
    <Link
      to="/records/$id"
      params={{ id: record.id }}
      search={{ returnWorkspace: workspaceHref(selection) }}
    >
      Open full record
    </Link>
  );
}
export function WorkspaceDetail({
  data,
  onClose,
}: {
  data: WorkspaceProjection;
  onClose: () => void;
}) {
  const detail = data.detail;
  if (!detail) return null;
  return (
    <aside className="block workspace-detail" aria-label="Related record details">
      <header>
        <h2>{detail.record.label}</h2>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="body">
        <p>
          <span className="code">{detail.record.name}</span> ·{' '}
          {detail.pinned ? `saved version ${detail.record.version}` : 'current record'} ·{' '}
          {detail.record.status === 'active' ? 'confirmed' : detail.record.status}
        </p>
        <p>{detail.overview.identity.map((part) => part.text).join(' · ')}</p>
        {detail.record.summary && <p>{detail.record.summary}</p>}
        <dl className="workspace-facts">
          {detail.overview.facts.map((fact) => (
            <div key={`${fact.label}-${fact.field}-${fact.value}`}>
              <dt>{fact.label}</dt>
              <dd className={fact.tone ? `${fact.tone}-ink` : undefined}>
                {fact.value}
                {fact.detail && <p className="muted">{fact.detail}</p>}
                <p
                  className={
                    fact.evidence?.source === 'assumed' || fact.evidence?.source === 'stated'
                      ? 'agent-ink'
                      : 'muted'
                  }
                >
                  {fact.evidence ? fact.evidence.source.replaceAll('_', ' ') : 'Source unknown'}
                  {fact.evidence?.note && ` · ${fact.evidence.note}`}
                </p>
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted">Secondary names, locations and inventory use current lab records.</p>
        {(detail.overview.omittedFacts > 0 || detail.overview.omittedIdentityParts > 0) && (
          <p>
            {detail.overview.omittedFacts} additional facts and{' '}
            {detail.overview.omittedIdentityParts} details available in the full record.
          </p>
        )}
        <FullRecord record={detail.record} selection={data.selection} />
      </div>
    </aside>
  );
}
