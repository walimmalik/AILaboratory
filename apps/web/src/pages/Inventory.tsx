import { add, compare, convert, formatQuantity } from '@ailab/domain';
import {
  type ContainerAttributes,
  type EntityAttributes,
  type EntityKindAttributes,
  inventoryEffectiveRules,
  inventoryHistory,
  inventoryListPlace,
  inventoryWells,
  inventoryWhereIs,
  type LocationAttributes,
  type Quantity,
  type RecordEnvelope,
  recordsList,
  type SampleAttributes,
  type WellState,
} from '@ailab/schema';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type CSSProperties, Fragment, type ReactNode, useState } from 'react';
import { api } from '../api.ts';
import { actorLabel, formatWhen, isAgent } from '../lib/format.ts';
import {
  atWords,
  type ContentGroup,
  contentGroups,
  fullestWell,
  gridOf,
  heatLevel,
  KEY_LINES,
  pathWords,
  placeWords,
  ruleLimit,
  ruleSources,
  ruleTitle,
  ruleWells,
  volumeText,
  wellRanges,
} from '../lib/inventory.ts';
import { type KindPage, libraryPages } from '../lib/kinds.ts';
import { recordsQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import { Head, useLabels } from './Instruments.tsx';
import { NewRecordButton } from './NewRecord.tsx';
import { RecordList } from './Records.tsx';

const page = (kind: string) => libraryPages.find((p) => p.kind === kind) as KindPage;
const words = (id: string) => id.replaceAll('_', ' ');

/** Labels of containers and locations together, for "where is it". */
function usePlaceLabels() {
  const locations = useLabels('location');
  const containers = useQuery(recordsQuery({ kind: 'container' })).data ?? [];
  return new Map([...locations, ...containers.map((c) => [c.id, c.name] as const)]);
}

/** The lab's containers (plan 010e): plates, tubes, reservoirs and boxes, where they are. */
export function ContainersPage() {
  const types = useLabels('labware_type');
  const places = usePlaceLabels();
  const of = (r: RecordEnvelope) => r.attributes as Partial<ContainerAttributes>;
  return (
    <>
      <Head
        page={page('container')}
        lede="Every plate, tube, reservoir and box in the lab. The name is the barcode. Open one to see what its wells hold, the handling rules it inherits and its history."
      />
      <RecordList
        title="Containers"
        kind="container"
        placeholder="Find by barcode or label, e.g. PLT-000001"
        empty="No containers yet. Ask the assistant to register some, or load the seed lab."
        columns={[
          {
            header: 'Labware',
            cell: (r) => types.get(of(r).labwareType ?? '') ?? '—',
          },
          { header: 'Where', cell: (r) => placeWords(of(r).place, places) },
          {
            header: 'State',
            cell: (r) => (of(r).status ? words(of(r).status as string) : '—'),
            className: 'muted',
          },
        ]}
      />
    </>
  );
}

/** Batches the lab made: minipreps, PCR products, cultures, cell banks. */
export function SamplesPage() {
  const entities = useLabels('entity');
  const of = (r: RecordEnvelope) => r.attributes as Partial<SampleAttributes>;
  return (
    <>
      <Head
        page={page('sample')}
        lede="Batches the lab made of something it keeps: minipreps, PCR products, purified proteins, cultures and cell banks, with their QC."
      />
      <RecordList
        title="Samples"
        kind="sample"
        placeholder="Find by name, e.g. miniprep or SMP-0001"
        empty="No samples yet. Ask the assistant to register a miniprep or a cell bank."
        columns={[
          { header: 'Of', cell: (r) => entities.get(of(r).entity ?? '') ?? '—' },
          { header: 'How', cell: (r) => (of(r).method ? words(of(r).method as string) : '—') },
          { header: 'Made', cell: (r) => of(r).made ?? '—', className: 'num' },
        ]}
      />
    </>
  );
}

/** The things the lab keeps track of: plasmids, cell lines, compounds, antibodies. */
export function EntitiesPage() {
  const kinds = useLabels('entity_kind');
  const of = (r: RecordEnvelope) => r.attributes as Partial<EntityAttributes>;
  return (
    <>
      <Head
        page={page('entity')}
        lede="What the lab works with, whatever form it is in: plasmids, cell lines, compounds, antibodies, enzymes. Samples and lots are batches of them."
      />
      <RecordList
        title="Entities"
        kind="entity"
        placeholder="Find by name or synonym, e.g. HEK293 or PLS-0001"
        empty="No entities yet. Ask the assistant to draft one, or load the seed lab."
        columns={[{ header: 'Kind', cell: (r) => kinds.get(of(r).entityKind ?? '') ?? '—' }]}
      />
    </>
  );
}

export function EntityKindsPage() {
  const of = (r: RecordEnvelope) => r.attributes as Partial<EntityKindAttributes>;
  return (
    <>
      <Head
        page={page('entity_kind')}
        lede="The kinds of things the lab keeps, each with its fields and the handling rules every one of them follows."
      />
      <RecordList
        title="Entity kinds"
        kind="entity_kind"
        placeholder="Find by name, e.g. Plasmid"
        empty="No entity kinds yet. Load the seed lab, or ask the assistant to draft one."
        columns={[
          { header: 'Prefix', cell: (r) => of(r).prefix ?? '—', className: 'mono' },
          { header: 'Base', cell: (r) => (of(r).base ? words(of(r).base as string) : '—') },
          { header: 'Fields', cell: (r) => of(r).fields?.length ?? 0, className: 'num' },
        ]}
      />
    </>
  );
}

/** The location tree with what is in each place. */
export function PlacesPage() {
  const locations = useQuery(recordsQuery({ kind: 'location' })).data ?? [];
  const [selected, setSelected] = useState<string>();
  const parentOf = (r: RecordEnvelope) => (r.attributes as Partial<LocationAttributes>).parent;
  const ids = new Set(locations.map((l) => l.id));
  const isRoot = (l: RecordEnvelope) => !ids.has(parentOf(l) ?? '');
  const children = (parent: string | undefined) =>
    locations
      .filter((l) => (parent ? parentOf(l) === parent : isRoot(l)))
      .sort((a, b) => a.label.localeCompare(b.label));
  const tree = (parent: string | undefined, depth: number): ReactNode[] =>
    children(parent).flatMap((l) => [
      <li key={l.id} style={{ paddingInlineStart: `${depth * 1.25}em` }}>
        <button
          type="button"
          className="link-btn"
          aria-pressed={selected === l.id}
          onClick={() => setSelected(l.id)}
        >
          {l.label}
        </button>{' '}
        <span className="muted">{placeKind(l)}</span>
      </li>,
      ...tree(l.id, depth + 1),
    ]);
  return (
    <>
      <Head
        page={page('location')}
        lede="Rooms, fridges, freezers, incubators and shelves, and what is in each."
        actions={<NewRecordButton kind="location" />}
      />
      <div className="places">
        <section className="block">
          <header>
            <h2>Places</h2>
            <span className="state muted num">{locations.length}</span>
          </header>
          <div className="body">
            {locations.length === 0 ? (
              <p className="empty">
                No places yet. Load the seed lab or ask the assistant to add rooms.
              </p>
            ) : (
              <ul className="tree">{tree(undefined, 0)}</ul>
            )}
          </div>
        </section>
        {selected ? (
          <PlaceContents id={selected} />
        ) : (
          <section className="block">
            <header>
              <h2>What is there</h2>
            </header>
            <div className="body">
              <p className="empty">Pick a place to see what is in it.</p>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function placeKind(r: RecordEnvelope) {
  const a = r.attributes as Partial<LocationAttributes>;
  return [a.type ? words(a.type) : undefined, a.setpoint ? formatQuantity(a.setpoint) : undefined]
    .filter(Boolean)
    .join(', ');
}

function PlaceContents({ id }: { id: string }) {
  const place = useQuery({
    queryKey: ['inventory', 'place', id],
    queryFn: () => api.run(inventoryListPlace, { place: id, deep: true }),
  });
  const here = place.data;
  return (
    <section className="block">
      <header>
        <h2>{here?.path.at(-1)?.label ?? 'What is there'}</h2>
        <span className="state muted num">
          {here ? `${here.containers.length} containers` : ''}
        </span>
      </header>
      <div className="body">
        {place.error && <p className="error-text">{place.error.message}</p>}
        {!here ? (
          <p className="empty">Loading…</p>
        ) : here.containers.length === 0 ? (
          <p className="empty">Nothing is registered here.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>Label</th>
                  <th>Where in it</th>
                </tr>
              </thead>
              <tbody>
                {here.containers.map((c) => (
                  <tr key={c.container.id}>
                    <td className="q">
                      <Link to="/records/$id" params={{ id: c.container.id }}>
                        {c.container.name}
                      </Link>
                    </td>
                    <td>{c.container.label}</td>
                    <td className="muted">
                      {c.path
                        .slice(here.path.length)
                        // The container's own row already names it.
                        .filter((p) => p.id !== c.container.id)
                        .map((p) => (p.position ? `${p.name} ${p.position}` : p.label))
                        .join(' › ') || 'here'}
                      {c.position ? ` ${c.position}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** On a container's page: its wells, the rules it inherits, and its ledger. */
export function ContainerBlocks({ record }: { record: RecordEnvelope }) {
  const wells = useQuery({
    queryKey: ['inventory', 'wells', record.id, record.version],
    queryFn: () => api.run(inventoryWells, { container: record.id }),
    retry: false,
  });
  // Racks, tip racks and lids hold no liquid; a box shows what is in its positions instead.
  if (wells.error) return <BoxContents record={record} />;
  if (!wells.data) return null;
  return (
    <>
      <WellsBlock positions={wells.data.positions} wells={wells.data.wells} name={record.name} />
      <RulesBlock record={record} filled={wells.data.wells.length} />
      <LedgerBlock record={record} />
    </>
  );
}

function BoxContents({ record }: { record: RecordEnvelope }) {
  const place = useQuery({
    queryKey: ['inventory', 'place', record.id],
    queryFn: () => api.run(inventoryListPlace, { place: record.id }),
  }).data;
  if (!place) return null;
  return (
    <section className="block" aria-label="In this box">
      <header>
        <h2>In this box</h2>
        <span className="state muted num">{place.containers.length}</span>
      </header>
      <div className="body">
        {place.containers.length === 0 ? (
          <p className="empty">Empty.</p>
        ) : (
          <ul className="plain">
            {place.containers.map((c) => (
              <li key={c.container.id}>
                <span className="mono">{c.position}</span>{' '}
                <Link to="/records/$id" params={{ id: c.container.id }}>
                  {c.container.name}
                </Link>{' '}
                {c.container.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Names of what the wells hold, fetched 500 at a time (a 1536-well library plate is 4 reads). */
function useSourceLabels(wells: { state: WellState }[]) {
  const ids = [...new Set(wells.flatMap((w) => w.state.components.map((c) => c.source)))].sort();
  const chunks = Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) =>
    ids.slice(i * 500, i * 500 + 500),
  );
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['records', 'ids', chunk],
      queryFn: () => api.run(recordsList, { ids: chunk }),
    })),
  });
  const labels = new Map(ids.map((id) => [id, id]));
  for (const r of results)
    for (const record of r.data?.records ?? []) labels.set(record.id, record.label);
  return labels;
}

function WellsBlock({
  positions,
  wells,
  name,
}: {
  positions: string[];
  wells: { well: string; state: WellState }[];
  name: string;
}) {
  const byWell = new Map(wells.map((w) => [w.well, w.state]));
  const grid = gridOf(positions);
  const fullest = fullestWell(wells.map((w) => w.state));
  const labels = useSourceLabels(wells);
  const groups = contentGroups(wells);
  const groupOf = new Map(groups.flatMap((g, i) => g.wells.map((w) => [w, i] as const)));
  // Shaded by what the wells hold when they don't all hold the same; by volume otherwise.
  const [shade, setShade] = useState<'contents' | 'volume'>(
    groups.length > 1 ? 'contents' : 'volume',
  );
  const [picked, setPicked] = useState<string | undefined>(grid ? undefined : 'A1');
  const [pointed, setPointed] = useState<string>();
  const [highlight, setHighlight] = useState<number>();
  const [find, setFind] = useState('');
  const state = picked ? byWell.get(picked) : undefined;
  const contentWords = (components: WellState['components']) =>
    components
      .map(
        (c) =>
          `${labels.get(c.source)}${c.concentration ? ` ${formatQuantity(c.concentration)}` : ''}`,
      )
      .join(' + ') || 'nothing named';
  const groupWords = (g: ContentGroup) => {
    const v = g.varying;
    const own = v
      ? `${v.each === 1 ? 'a different' : v.each} ${v.noun}${v.each === 1 ? '' : 's'} in each well${v.concentration ? ` at ${formatQuantity(v.concentration)}` : ''}`
      : undefined;
    return [own, g.components.length > 0 ? contentWords(g.components) : undefined]
      .filter(Boolean)
      .join(' + ');
  };
  // Past six groups the colours would repeat, so the smaller ones share one quiet shade.
  const colour = (group: number) => (group < 6 ? `data-${group + 1}` : 'data-rest');
  const [allLines, setAllLines] = useState(false);
  const shown = allLines || groups.length <= KEY_LINES ? groups : groups.slice(0, KEY_LINES - 1);
  const folded = groups.slice(shown.length);
  const describe = (well: string) => {
    const s = byWell.get(well);
    return s ? `${well}: ${volumeText(s)}, ${contentWords(s.components)}` : `${well}: empty`;
  };
  // A well name picks the well; any other text lights up the wells whose contents match it.
  const query = find.trim().toLowerCase();
  const wellQuery = /^[a-z]{1,2}\d{1,2}$/i.test(query) ? query.toUpperCase() : undefined;
  const matches = (well: string) => {
    if (highlight !== undefined) return groupOf.get(well) === highlight;
    if (!query || wellQuery) return true;
    const s = byWell.get(well);
    return !!s?.components.some((c) => labels.get(c.source)?.toLowerCase().includes(query));
  };
  const lit = query && !wellQuery ? wells.filter((w) => matches(w.well)).length : undefined;
  const exportCsv = () => {
    const rows = [['well', 'volume', 'unit', 'contents', 'estimated']];
    for (const w of wells) {
      const v = w.state.volume;
      rows.push([
        w.well,
        v === 'unknown' ? '' : v.value,
        v === 'unknown' ? '' : v.unit,
        contentWords(w.state.components),
        w.state.assumed ? 'yes' : '',
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-wells.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="block" aria-label="Wells">
      <header>
        <h2>{grid ? 'Wells' : 'Contents'}</h2>
        <span className="state muted num">
          {grid ? `${wells.length} of ${positions.length} filled` : ''}
        </span>
      </header>
      <div className="body">
        {grid && wells.length > 0 && (
          <ul className="contents-key" aria-label="What the wells hold">
            {shown.map((g, i) => (
              <li key={g.key}>
                <button
                  type="button"
                  aria-pressed={highlight === i}
                  title="Show only these wells"
                  onClick={() => setHighlight(highlight === i ? undefined : i)}
                >
                  <i className={`swatch ${colour(i)}`} aria-hidden="true" />
                  <span className="num">
                    {g.wells.length} {g.wells.length === 1 ? 'well' : 'wells'}
                  </span>
                  <span>{groupWords(g)}</span>
                  <span className="mono muted">{wellRanges(g.wells)}</span>
                </button>
              </li>
            ))}
            {folded.length > 0 && (
              <li>
                <button type="button" className="more" onClick={() => setAllLines(true)}>
                  <i className="swatch data-rest" aria-hidden="true" />
                  <span className="num">
                    {folded.reduce((n, g) => n + g.wells.length, 0)} wells
                  </span>
                  <span className="muted">{folded.length} more mixes: show them</span>
                  <span />
                </button>
              </li>
            )}
          </ul>
        )}
        {grid && (
          <div className="plate-tools">
            <input
              type="search"
              placeholder="Find a well or what it holds (B7, staurosporine)"
              aria-label="Find a well or what it holds"
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setHighlight(undefined);
                const w = e.target.value.trim().toUpperCase();
                if (/^[A-Z]{1,2}\d{1,2}$/.test(w) && positions.includes(w)) setPicked(w);
              }}
            />
            {lit !== undefined && (
              <span className="muted">{lit === 1 ? '1 well matches' : `${lit} wells match`}</span>
            )}
            <fieldset className="segmented">
              <legend className="sr-only">Shade by</legend>
              <button
                type="button"
                aria-pressed={shade === 'contents'}
                onClick={() => setShade('contents')}
              >
                Contents
              </button>
              <button
                type="button"
                aria-pressed={shade === 'volume'}
                onClick={() => setShade('volume')}
              >
                Volume
              </button>
            </fieldset>
            {wells.length > 0 && (
              <button type="button" className="btn small" onClick={exportCsv}>
                Export CSV
              </button>
            )}
          </div>
        )}
        <div className="plate-layout">
          {grid && (
            <div className="plate-wrap">
              {shade === 'volume' && (
                <ul className="legend" aria-label="Key">
                  <li>
                    <i />
                    Empty
                  </li>
                  <li>
                    <i className="heat-2" />
                    Less
                  </li>
                  <li>
                    <i className="heat-4" />
                    {fullest ? `Fullest, ${formatQuantity(fullest)}` : 'Fullest'}
                  </li>
                  <li>
                    <i className="heat-unknown" />
                    Volume unknown
                  </li>
                  <li>
                    <i className="assumed" />
                    Estimated
                  </li>
                </ul>
              )}
              <fieldset
                className={`plate${grid.columns > 12 ? ' dense' : ''}`}
                aria-label={`Plate map, shaded by ${shade}`}
                style={{ '--cols': grid.columns } as CSSProperties}
              >
                <span className="axis" />
                {Array.from({ length: grid.columns }, (_, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                  <span key={c} className="axis">
                    {c + 1}
                  </span>
                ))}
                {grid.rowLabels.map((row) => (
                  <Fragment key={row}>
                    <span className="axis">{row}</span>
                    {Array.from({ length: grid.columns }, (_, c) => {
                      const well = `${row}${c + 1}`;
                      const s = byWell.get(well);
                      const group = groupOf.get(well);
                      const fill =
                        shade === 'contents'
                          ? group === undefined
                            ? 'heat-0'
                            : colour(group)
                          : `heat-${heatLevel(s, fullest)}`;
                      return (
                        <button
                          key={well}
                          type="button"
                          className={`well ${fill}${s?.assumed ? ' assumed' : ''}${matches(well) ? '' : ' dim'}`}
                          aria-pressed={picked === well}
                          aria-label={describe(well)}
                          onClick={() => setPicked(well)}
                          onMouseEnter={() => setPointed(well)}
                          onFocus={() => setPointed(well)}
                          onMouseLeave={() => setPointed(undefined)}
                          onBlur={() => setPointed(undefined)}
                        />
                      );
                    })}
                  </Fragment>
                ))}
              </fieldset>
              <p className="hover-info" aria-live="polite">
                {pointed
                  ? describe(pointed)
                  : 'Point at a well to see what it holds; select it for details.'}
              </p>
            </div>
          )}
          {picked &&
            (state ? (
              <div className="well-detail">
                <h3>
                  {grid ? `${picked}: ` : ''}
                  {volumeText(state)}
                  {state.assumed && <span className="agent-ink"> (estimated)</span>}
                </h3>
                <ul className="plain">
                  {state.components.map((c) => (
                    <li key={c.source}>
                      <Link to="/records/$id" params={{ id: c.source }}>
                        {labels.get(c.source)}
                      </Link>
                      {c.concentration
                        ? ` at ${formatQuantity(c.concentration)}`
                        : c.amount
                          ? `, ${formatQuantity(c.amount)}`
                          : ', concentration not known'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="empty well-detail">{grid ? `${picked} is empty.` : 'Empty.'}</p>
            ))}
        </div>
      </div>
    </section>
  );
}

function RulesBlock({ record, filled }: { record: RecordEnvelope; filled: number }) {
  const effective = useQuery({
    queryKey: ['inventory', 'rules', record.id, record.version, filled],
    queryFn: () => api.run(inventoryEffectiveRules, { container: record.id }),
  }).data;
  if (!effective || (effective.rules.length === 0 && !effective.storage)) return null;
  return (
    <section className="block" aria-label="Handling">
      <header>
        <h2>Handling</h2>
        <span className="state muted">from what it holds</span>
      </header>
      <div className="body">
        <ul className="rules">
          {effective.storage && (
            <li>
              <b>Store {atWords(effective.storage.range)}</b>
              {effective.storage.conflict && (
                <span className="warn-ink"> {effective.storage.conflict}</span>
              )}
              <div className="muted">
                From {effective.storage.from.map((f) => f.origin.label).join(', ')}
              </div>
            </li>
          )}
          {effective.rules.map((r) => {
            const limit = ruleLimit(r.rule);
            const where = ruleWells(r, filled);
            return (
              <li key={`${r.rule.rule}-${r.rule.text}`}>
                <b>
                  {ruleTitle[r.rule.rule]}
                  {limit ? `: ${limit}` : ''}
                </b>{' '}
                <span className={r.rule.enforced ? 'chip' : 'chip muted'}>
                  {r.rule.enforced ? 'scheduler keeps to it' : 'advice'}
                </span>
                <div>{r.rule.text}</div>
                {r.conflict && <div className="warn-ink">{r.conflict}</div>}
                <div className="muted">
                  From {ruleSources(r)}
                  {where ? `, wells ${where}` : ''}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const eventWords: Record<string, string> = {
  fill: 'Filled',
  transfer: 'Transfer',
  stamp: 'Stamped',
  consume: 'Used',
  correct: 'Corrected',
  discard: 'Discarded',
};

function LedgerBlock({ record }: { record: RecordEnvelope }) {
  const me = useMe();
  const events =
    useQuery({
      queryKey: ['inventory', 'history', record.id, record.version],
      queryFn: async () =>
        (await api.run(inventoryHistory, { container: record.id, limit: 20 })).events,
    }).data ?? [];
  if (events.length === 0) return null;
  return (
    <section className="block" aria-label="Ledger">
      <header>
        <h2>Ledger</h2>
        <span className="state muted">latest {events.length}</span>
      </header>
      <div className="body">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Wells</th>
                <th>By</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const mine = e.lines.filter((l) => l.container === record.id);
                return (
                  <tr key={e.id}>
                    <td className="when">{formatWhen(e.at)}</td>
                    <td>{eventWords[e.type] ?? e.type}</td>
                    <td className="num">{mine.length}</td>
                    <td className={isAgent(e.actor) ? 'agent-ink' : undefined}>
                      {actorLabel(e.actor, me)}
                    </td>
                    <td className="muted">{e.reason ?? ''}</td>
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

/** On an entity's page: the batches the lab made of it. */
export function EntityBlocks({ record }: { record: RecordEnvelope }) {
  const samples = (useQuery(recordsQuery({ kind: 'sample' })).data ?? []).filter(
    (s) => (s.attributes as Partial<SampleAttributes>).entity === record.id,
  );
  if (samples.length === 0) return null;
  return (
    <section className="block" aria-label="Samples">
      <header>
        <h2>Samples</h2>
        <span className="state muted num">{samples.length}</span>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Label</th>
              <th>How</th>
              <th>Made</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s) => {
              const a = s.attributes as Partial<SampleAttributes>;
              return (
                <tr key={s.id}>
                  <td>
                    <Link to="/records/$id" params={{ id: s.id }}>
                      {s.name}
                    </Link>
                  </td>
                  <td>{s.label}</td>
                  <td>{a.method ? words(a.method) : '—'}</td>
                  <td className="num">{a.made ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Where a lot, sample or product is (review finding: "find a lot and see where it is"): each
 * container holding it, where that container is, and how much of it is there.
 */
export function WhereIsBlock({ record }: { record: RecordEnvelope }) {
  const where = useQuery({
    queryKey: ['inventory', 'where', record.id],
    queryFn: () => api.run(inventoryWhereIs, { of: record.id }),
    retry: false,
  });
  const containers = where.data?.containers ?? [];
  // A product that nothing holds yet says nothing; a lot or sample says so.
  if (record.kind === 'product' && containers.length === 0) return null;
  return (
    <section className="block" aria-label="Where it is">
      <header>
        <h2>Where it is</h2>
        <span className="state muted num">
          {containers.length === 1 ? '1 container' : `${containers.length} containers`}
        </span>
      </header>
      <div className="body">
        {where.error && <p className="error-text">{where.error.message}</p>}
        {where.data && containers.length === 0 && (
          <p className="empty">Not in any container the lab has registered.</p>
        )}
        {containers.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Container</th>
                  <th>Where</th>
                  <th>How much</th>
                </tr>
              </thead>
              <tbody>
                {containers.map(({ container, path, wells }) => (
                  <tr key={container.id}>
                    <td>
                      <Link to="/records/$id" params={{ id: container.id }} className="mono">
                        {container.name}
                      </Link>{' '}
                      {container.label}
                    </td>
                    <td>{pathWords(path.slice(0, -1)) || 'Place not known'}</td>
                    <td className="num">{amountWords(wells)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** A volume in the largest unit that keeps it at 1 or more: 15350.4 µL reads as 15.3504 mL. */
function readableVolume(q: Quantity): Quantity {
  for (const unit of ['L', 'mL', 'uL', 'nL']) {
    const v = convert(q, unit);
    if (Number(v.value) >= 1) return v;
  }
  return q;
}

type WhereWell = {
  well: string;
  volume: WellState['volume'];
  component: WellState['components'][number];
};

/** "200 µL at 1 mM" for a tube; "384 wells, 25 nL to 40 µL, 15.4 mL in all, at 100 % v/v" for a plate. */
function amountWords(wells: readonly WhereWell[]): string {
  const strengths = [
    ...new Set(
      wells.map((w) => {
        const q = w.component.concentration ?? w.component.amount;
        return q ? formatQuantity(q) : undefined;
      }),
    ),
  ].filter((q): q is string => q !== undefined);
  const at = strengths.length === 1 ? ` at ${strengths[0]}` : '';
  const known = wells.flatMap((w) => (w.volume === 'unknown' ? [] : [w.volume]));
  if (wells.length === 1) {
    const [only] = wells as [WhereWell];
    return `${only.volume === 'unknown' ? 'volume unknown' : formatQuantity(only.volume)}${at}`;
  }
  const count = `${wells.length} wells`;
  if (known.length === 0) return `${count}${at}`;
  const sorted = [...known].sort(compare);
  const least = sorted[0] as (typeof sorted)[number];
  const most = sorted[sorted.length - 1] as (typeof sorted)[number];
  const range =
    compare(least, most) === 0
      ? `${formatQuantity(least)} each`
      : `${formatQuantity(least)} to ${formatQuantity(most)}`;
  // Summed in the unit of the fullest well, so a plate reads in µL rather than millions of nL.
  const total = known.reduce<Quantity>((sum, q) => add(sum, q), { value: '0', unit: most.unit });
  return `${count}, ${range}, ${formatQuantity(readableVolume(total))} in all${at}`;
}
