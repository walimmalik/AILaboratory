import { formatQuantity } from '@ailab/domain';
import {
  type CapabilityId,
  type CapabilityLimits,
  capabilityCatalog,
  type InstrumentStatus,
  type MountDefinition,
  type ResolvedConfiguration,
} from '@ailab/schema';

/** Plain words for instruments (plan 008c): capabilities with their limits, status, deck layouts. */

const q = (v: { value: string; unit: string }) => formatQuantity(v);
type Q = { value: string; unit: string };
const range = (r: { min?: Q | undefined; max?: Q | undefined }) =>
  r.min && r.max
    ? `${q(r.min)} to ${q(r.max)}`
    : r.min
      ? `from ${q(r.min)}`
      : r.max
        ? `up to ${q(r.max)}`
        : '';
const list = (items: (string | number)[]) =>
  items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

/** "5 µL to 1000 µL · 1 or 8 channels", or '' when there are no limits. */
export function limitWords(limits: CapabilityLimits | undefined): string {
  if (!limits) return '';
  const parts: string[] = [];
  if (limits.volume) parts.push(range(limits.volume));
  if (limits.volumeStep) parts.push(`in steps of ${q(limits.volumeStep)}`);
  if (limits.channels) {
    const one = limits.channels.length === 1 && limits.channels[0] === 1;
    parts.push(`${list(limits.channels)} ${one ? 'channel' : 'channels'}`);
  }
  if (limits.temperature) {
    const t = limits.temperature;
    const low = t.minAboveAmbient ? `${q(t.minAboveAmbient)} above room temperature` : undefined;
    parts.push(low ? (t.max ? `${low} to ${q(t.max)}` : `from ${low}`) : range(t));
  }
  if (limits.speed) parts.push(range(limits.speed));
  if (limits.force) parts.push(`up to ${q(limits.force.max)}`);
  if (limits.wavelengths) {
    const w = limits.wavelengths;
    if (w.fixed) parts.push(`at ${list(w.fixed.map(q))}`);
    if (w.min || w.max) parts.push(range(w));
  }
  if (limits.wellCounts) parts.push(`${list(limits.wellCounts)}-well plates`);
  if (limits.capacity) parts.push(`${limits.capacity} at once`);
  if (limits.note) parts.push(limits.note);
  return parts.filter(Boolean).join(' · ');
}

export function capabilityLabel(id: CapabilityId): string {
  return capabilityCatalog[id].label;
}

export const statusWords: Record<InstrumentStatus, string> = {
  ready: 'ready',
  in_use: 'in use',
  maintenance: 'in maintenance',
  out_of_service: 'out of service',
};

/** The lamp class for a status: on (ready), busy (in use), off (maintenance, out of service). */
export function statusLamp(status: InstrumentStatus): 'on' | 'busy' | 'off' {
  return status === 'ready' ? 'on' : status === 'in_use' ? 'busy' : 'off';
}

export interface DeckCell {
  /** The slot name, or the track range. */
  place: string;
  row: number;
  column: number;
  /** Columns it spans (tracks on a rail). */
  span: number;
  /** The equipment on it, when any. */
  node?: string;
}

export interface DeckView {
  mount: string;
  label: string;
  rows: number;
  columns: number;
  cells: DeckCell[];
}

/**
 * How to draw one mount from above: slots named like A1 to D3 as a grid (rows by letter, columns by
 * number), other slots in one row, a rail as its tracks with each claim spanning its run, a fixed
 * mount as one place. Equipment comes from the resolved claims.
 */
export function deckView(
  mount: MountDefinition,
  claims: ResolvedConfiguration['claims'],
): DeckView {
  const mine = claims.filter((c) => c.parent === 'instrument' && c.mount === mount.id);
  const base = { mount: mount.id, label: mount.label };
  const layout = mount.layout;
  if (layout.layout === 'rail') {
    const cells: DeckCell[] = [];
    let track = 1;
    const sorted = mine
      .filter((c) => c.tracks)
      .sort((a, b) => (a.tracks?.from ?? 0) - (b.tracks?.from ?? 0));
    for (const claim of sorted) {
      const { from, to } = claim.tracks as { from: number; to: number };
      if (from > track)
        cells.push({
          place: `${track}–${from - 1}`,
          row: 0,
          column: track - 1,
          span: from - track,
        });
      cells.push({
        place: `${from}–${to}`,
        row: 0,
        column: from - 1,
        span: to - from + 1,
        node: claim.node,
      });
      track = to + 1;
    }
    if (track <= layout.tracks) {
      cells.push({
        place: `${track}–${layout.tracks}`,
        row: 0,
        column: track - 1,
        span: layout.tracks - track + 1,
      });
    }
    return { ...base, rows: 1, columns: layout.tracks, cells };
  }
  const nodeAt = (slot: string) => mine.find((c) => c.slots?.includes(slot))?.node;
  if (layout.layout === 'fixed') {
    const node = mine[0]?.node;
    return {
      ...base,
      rows: 1,
      columns: 1,
      cells: [{ place: mount.label, row: 0, column: 0, span: 1, ...(node ? { node } : {}) }],
    };
  }
  const named = layout.slots.map((slot) => /^([A-Z])(\d+)$/.exec(slot));
  if (named.every(Boolean)) {
    const rows = [...new Set(named.map((m) => (m as RegExpExecArray)[1] as string))].sort();
    const columns = [...new Set(named.map((m) => Number((m as RegExpExecArray)[2])))].sort(
      (a, b) => a - b,
    );
    return {
      ...base,
      rows: rows.length,
      columns: columns.length,
      cells: layout.slots.map((slot, i) => {
        const m = named[i] as RegExpExecArray;
        const node = nodeAt(slot);
        return {
          place: slot,
          row: rows.indexOf(m[1] as string),
          column: columns.indexOf(Number(m[2])),
          span: 1,
          ...(node ? { node } : {}),
        };
      }),
    };
  }
  return {
    ...base,
    rows: 1,
    columns: layout.slots.length,
    cells: layout.slots.map((slot, i) => {
      const node = nodeAt(slot);
      return { place: slot, row: 0, column: i, span: 1, ...(node ? { node } : {}) };
    }),
  };
}
