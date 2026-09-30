import { formatQuantity } from '@ailab/domain';
import type { LiquidClassAttributes, RecordEnvelope, StorageBand } from '@ailab/schema';

/** Liquid screens (plan 009c): the class matrix and plain words for reagents and classes. */

export const storageWords: Record<StorageBand, string> = {
  room: 'room temperature',
  fridge: 'fridge',
  freezer: 'freezer',
  deep_freezer: '−80 freezer',
  cryo: 'liquid nitrogen',
};

export const platformWords: Record<LiquidClassAttributes['settings']['platform'], string> = {
  opentrons: 'Opentrons',
  hamilton: 'Hamilton',
  echo: 'Echo',
  dispenser: 'dispenser',
  manual: 'by hand',
};

/** "5 µL to 1000 µL", "from 2.5 nL", or "—". */
export function volumeWords(volume: LiquidClassAttributes['volume']): string {
  if (volume?.min && volume.max) {
    return `${formatQuantity(volume.min)} to ${formatQuantity(volume.max)}`;
  }
  if (volume?.min) return `from ${formatQuantity(volume.min)}`;
  if (volume?.max) return `up to ${formatQuantity(volume.max)}`;
  return '—';
}

/**
 * What people call a record in a crowded place like a matrix row: an instrument model by its model
 * name ("Microlab STAR"), an Echo source plate by its plate code ("384LDV"), anything else by its
 * label. The full label stays on hover.
 */
export function shortLabel(record: Pick<RecordEnvelope, 'kind' | 'label' | 'attributes'>): string {
  const attributes = (record.attributes ?? {}) as { model?: unknown };
  if (record.kind === 'instrument_kind' && typeof attributes.model === 'string' && attributes.model)
    return attributes.model;
  if (record.kind === 'labware_type') {
    // The plate code has a digit in it: "(384LDV)", not "(COC)".
    const code = [...record.label.matchAll(/\(([0-9A-Z]{3,12})\)/g)]
      .map((m) => m[1] as string)
      .findLast((c) => /\d/.test(c));
    if (code) return code;
  }
  return record.label;
}

export interface MatrixClass {
  record: RecordEnvelope;
  attributes: LiquidClassAttributes;
  verified: boolean;
}

export interface MatrixCell {
  /** Classes serving this liquid type on this device, confirmed first. */
  classes: MatrixClass[];
  confirmed: number;
  verified: number;
  /** A confirmed lab default serves it. */
  hasDefault: boolean;
}

export interface MatrixRow {
  key: string;
  label: string;
  /** The full names, for hover. */
  title: string;
  cells: Map<string, MatrixCell>;
}

/**
 * Liquid types against the lab's pipetting devices (plan 009, Screens): one row per instrument
 * model and device (or source plate type, for the Echo), one column per liquid type, each cell the
 * classes that serve it. `label` names a record by ID; unknown IDs show as themselves.
 */
export function classMatrix(
  classes: MatrixClass[],
  liquidTypes: string[],
  label: (id: string) => string,
  short: (id: string) => string = label,
): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  for (const c of classes) {
    const a = c.attributes;
    const part = a.device ?? a.sourceLabware;
    const key = `${a.instrumentKind}/${part ?? ''}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        label: part ? `${short(a.instrumentKind)} · ${short(part)}` : short(a.instrumentKind),
        title: part ? `${label(a.instrumentKind)} · ${label(part)}` : label(a.instrumentKind),
        cells: new Map(),
      };
      rows.set(key, row);
    }
    for (const type of a.liquidTypes) {
      if (!liquidTypes.includes(type)) continue;
      const cell = row.cells.get(type) ?? {
        classes: [],
        confirmed: 0,
        verified: 0,
        hasDefault: false,
      };
      const active = c.record.status === 'active';
      cell.classes.push(c);
      if (active) cell.confirmed += 1;
      if (active && c.verified) cell.verified += 1;
      if (active && a.labDefault) cell.hasDefault = true;
      row.cells.set(type, cell);
    }
  }
  for (const row of rows.values()) {
    for (const cell of row.cells.values()) {
      cell.classes.sort(
        (x, y) =>
          Number(y.record.status === 'active') - Number(x.record.status === 'active') ||
          x.record.label.localeCompare(y.record.label),
      );
    }
  }
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * A cell in words. Nothing at all is a quiet dash; drafts waiting for a person and a missing
 * default are the gaps, in agent ink.
 */
export function cellWords(cell: MatrixCell | undefined): {
  text: string;
  tone?: 'muted' | 'agent';
} {
  if (!cell || cell.classes.length === 0) return { text: '—', tone: 'muted' };
  const n = cell.classes.length;
  if (cell.confirmed === 0) return { text: `${n} ${n === 1 ? 'draft' : 'drafts'}`, tone: 'agent' };
  const classes = `${n} ${n === 1 ? 'class' : 'classes'}`;
  if (!cell.hasDefault) return { text: `${classes}, no default`, tone: 'agent' };
  return {
    text: cell.verified > 0 ? `${classes}, ${cell.verified} verified` : `${classes}, not verified`,
  };
}
