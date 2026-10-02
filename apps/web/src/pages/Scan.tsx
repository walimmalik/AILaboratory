import {
  type ContainerPlace,
  inventoryConsume,
  inventoryDiscard,
  inventoryMove,
  inventoryScan,
  type LiquidVolume,
  type PlacePath,
  type RecordEnvelope,
} from '@ailab/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { pathWords } from '../lib/inventory.ts';

type Found = Awaited<ReturnType<typeof scan>>;
const scan = (code: string) => api.run(inventoryScan, { code: code.trim() });

const kindWords: Record<string, string> = {
  container: 'Container',
  location: 'Place',
  lot: 'Lot',
  sample: 'Sample',
  entity: 'Entity',
  product: 'Reagent',
  instrument: 'Instrument',
  labware_type: 'Labware type',
};

/**
 * One field that takes any code (USB scanners type into it and press Enter) and opens what it
 * names, with quick actions for a container: move it, record liquid used, discard it (plan 010e).
 */
export function ScanPage() {
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Found>();
  const [done, setDone] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const lookup = useMutation({
    mutationFn: scan,
    onSuccess: (result) => {
      setFound(result);
      setCode('');
    },
    onError: () => setFound(undefined),
  });
  useEffect(() => input.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(undefined);
    if (code.trim()) lookup.mutate(code);
  };
  const refresh = async (message: string) => {
    setDone(message);
    if (found) setFound(await scan(found.record.name));
    input.current?.focus();
  };
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>scan</b>
          </div>
          <h1>Scan</h1>
          <p className="lede">
            Scan or type a barcode or a readable name (PLT-000001, plt1, a FluidX code) to open it.
          </p>
        </div>
      </div>
      <form className="toolbar scan-bar" onSubmit={submit}>
        <input
          ref={input}
          className="field grow"
          aria-label="Code"
          placeholder="Scan or type a code"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" className="btn" disabled={lookup.isPending}>
          Find
        </button>
      </form>
      {lookup.error && (
        <p className="error-text">
          {lookup.error.message}.{' '}
          {/* A name rather than a code: Stock finds things by what they are called. */}
          <Link to="/inventory" search={{ find: lookup.variables?.trim() ?? '' }}>
            Find “{lookup.variables?.trim()}” in Stock
          </Link>
        </p>
      )}
      {done && <p className="muted">{done}</p>}
      {found && <FoundBlock found={found} onChanged={refresh} />}
    </>
  );
}

function FoundBlock({
  found,
  onChanged,
}: {
  found: Found;
  onChanged: (message: string) => Promise<void>;
}) {
  const { record, path, matched } = found;
  const discarded =
    record.kind === 'container' &&
    (record.attributes as { status?: string }).status === 'discarded';
  return (
    <section className="block" aria-label="Found">
      <header>
        <h2>
          {kindWords[record.kind] ?? record.kind.replaceAll('_', ' ')} {record.name}
        </h2>
        <span className="state muted">{matched === 'barcode' ? 'by its printed code' : ''}</span>
      </header>
      <div className="body scan-found">
        <p>
          <b>{record.label}</b>
          {discarded && <span className="chip archived"> discarded</span>}
        </p>
        {/* Where it is, from the room down to what holds it; the record is not part of its own place. */}
        {path && <p className="muted">{whereWords(path, record.id)}</p>}
        <p>
          <Link to="/records/$id" params={{ id: record.id }}>
            Open {record.name}
          </Link>
        </p>
        {record.kind === 'container' && !discarded && (
          <ContainerActions record={record} onChanged={onChanged} />
        )}
      </div>
    </section>
  );
}

/** "Cold room › Box 7, position B3": the record's own entry gives only its position. */
function whereWords(path: PlacePath, self: string): string {
  const above = pathWords(path.filter((p) => p.id !== self));
  const position = path.find((p) => p.id === self)?.position;
  if (!above) return 'Place not known';
  return position ? `${above}, position ${position}` : above;
}

const units: LiquidVolume['unit'][] = ['uL', 'mL', 'nL', 'L'];
const unitWords: Record<LiquidVolume['unit'], string> = { uL: 'µL', mL: 'mL', nL: 'nL', L: 'L' };

function ContainerActions({
  record,
  onChanged,
}: {
  record: RecordEnvelope;
  onChanged: (message: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<'move' | 'consume' | 'discard'>();
  const [to, setTo] = useState('');
  const [position, setPosition] = useState('');
  const [wells, setWells] = useState('A1');
  const [volume, setVolume] = useState('');
  const [unit, setUnit] = useState<LiquidVolume['unit']>('uL');
  const [reason, setReason] = useState('');
  const after = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ['records'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    setOpen(undefined);
    setReason('');
    await onChanged(message);
  };
  const why = reason.trim() ? { reason: reason.trim() } : {};

  const move = useMutation({
    mutationFn: async () => {
      const target = (await scan(to)).record;
      let place: ContainerPlace;
      if (target.kind === 'location') place = { location: target.id };
      else if (target.kind === 'container') {
        if (!position.trim()) throw new Error(`Say which position in ${target.name}, e.g. B3`);
        place = { container: target.id, position: position.trim().toUpperCase() };
      } else throw new Error(`${target.name} is not a place or a box`);
      return api.run(inventoryMove, {
        container: record.id,
        expectedVersion: record.version,
        to: place,
        ...why,
      });
    },
    onSuccess: (r) => after(`Moved ${record.name} to ${pathWords(r.path)}.`),
  });
  const consume = useMutation({
    mutationFn: () =>
      api.run(inventoryConsume, {
        container: record.id,
        wells: wells
          .split(/[\s,]+/)
          .map((w) => w.trim().toUpperCase())
          .filter(Boolean),
        volume: { value: volume.trim(), unit },
        ...why,
      }),
    onSuccess: () =>
      after(`Recorded ${volume.trim()} ${unitWords[unit]} used from ${record.name}.`),
  });
  const discard = useMutation({
    mutationFn: () =>
      api.run(inventoryDiscard, {
        container: record.id,
        expectedVersion: record.version,
        ...why,
      }),
    onSuccess: () => after(`Discarded ${record.name}.`),
  });
  const running = move.isPending || consume.isPending || discard.isPending;
  const error = (open === 'move' ? move : open === 'consume' ? consume : discard).error;
  const reasonField = (
    <input
      className="field grow"
      aria-label="Why"
      placeholder="Why (optional)"
      value={reason}
      onChange={(e) => setReason(e.target.value)}
    />
  );

  return (
    <div className="scan-actions">
      <div className="toolbar">
        {(['move', 'consume', 'discard'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className="btn small"
            aria-pressed={open === a}
            onClick={() => setOpen(open === a ? undefined : a)}
          >
            {a === 'move' ? 'Move' : a === 'consume' ? 'Record use' : 'Discard'}
          </button>
        ))}
      </div>
      {open === 'move' && (
        <form
          className="toolbar"
          aria-label="Move"
          onSubmit={(e) => {
            e.preventDefault();
            move.mutate();
          }}
        >
          <input
            className="field grow"
            aria-label="To"
            placeholder="Scan the place or box"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <input
            className="field"
            aria-label="Position"
            placeholder="Position in a box"
            size={8}
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
          {reasonField}
          <button type="submit" className="btn primary" disabled={running || !to.trim()}>
            Move
          </button>
        </form>
      )}
      {open === 'consume' && (
        <form
          className="toolbar"
          aria-label="Record use"
          onSubmit={(e) => {
            e.preventDefault();
            consume.mutate();
          }}
        >
          <input
            className="field"
            aria-label="Wells"
            size={10}
            value={wells}
            onChange={(e) => setWells(e.target.value)}
          />
          <input
            className="field num"
            aria-label="Volume per well"
            placeholder="Volume per well"
            inputMode="decimal"
            size={10}
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
          />
          <select
            className="field"
            aria-label="Unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as LiquidVolume['unit'])}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {unitWords[u]}
              </option>
            ))}
          </select>
          {reasonField}
          <button type="submit" className="btn primary" disabled={running || !volume.trim()}>
            Record
          </button>
        </form>
      )}
      {open === 'discard' && (
        <form
          className="toolbar"
          aria-label="Discard"
          onSubmit={(e) => {
            e.preventDefault();
            discard.mutate();
          }}
        >
          <span>Empty every well in the ledger and mark {record.name} discarded?</span>
          {reasonField}
          <button type="submit" className="btn danger" disabled={running}>
            Discard {record.name}
          </button>
        </form>
      )}
      {open && error && <p className="error-text">{error.message}</p>}
    </div>
  );
}
