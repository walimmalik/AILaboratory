import { compare, convert, formatQuantity, parseWellName } from '@ailab/domain';
import type {
  ContainerPlace,
  EffectiveRule,
  HandlingRule,
  PlacePath,
  Quantity,
  StorageRange,
  WellState,
} from '@ailab/schema';

/** Inventory screens (plan 010e): plate grids, heat maps and rules in plain words. */

export interface WellGrid {
  rows: number;
  columns: number;
  /** Row letters top to bottom. */
  rowLabels: string[];
}

/** The grid a container's positions make, or undefined for a tube or trough (one well, A1). */
export function gridOf(positions: readonly string[]): WellGrid | undefined {
  if (positions.length <= 1) return undefined;
  let rows = 0;
  let columns = 0;
  const labels = new Map<number, string>();
  for (const name of positions) {
    const { row, column } = parseWellName(name);
    rows = Math.max(rows, row + 1);
    columns = Math.max(columns, column + 1);
    labels.set(row, name.replace(/\d+$/, ''));
  }
  return {
    rows,
    columns,
    rowLabels: Array.from({ length: rows }, (_, r) => labels.get(r) ?? ''),
  };
}

/**
 * Heat map level 0 to 4 for a well's volume against the fullest well: 0 is empty, 4 the fullest
 * quarter. An unknown volume is "unknown", drawn hatched.
 */
export function heatLevel(state: WellState | undefined, fullest: Quantity | undefined) {
  if (!state) return 0;
  if (state.volume === 'unknown') return 'unknown' as const;
  if (!fullest || Number(fullest.value) === 0) return 0;
  const share = Number(convert(state.volume, fullest.unit).value) / Number(fullest.value);
  if (share <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil(share * 4)));
}

/** The largest known volume among the wells, for the heat map's scale. */
export function fullestWell(states: readonly WellState[]): Quantity | undefined {
  let fullest: Quantity | undefined;
  for (const s of states) {
    if (s.volume === 'unknown') continue;
    if (!fullest || compare(s.volume, fullest) > 0) fullest = s.volume;
  }
  return fullest;
}

export const volumeText = (state: WellState) =>
  state.volume === 'unknown' ? 'volume unknown' : formatQuantity(state.volume);

/** "Cold room › Freezer −20 › BOX-000003 B3". */
export function pathWords(path: PlacePath): string {
  return path.map((p) => (p.position ? `${p.name} ${p.position}` : p.label)).join(' › ');
}

/** Where a container is from its attributes alone, with names from `labels`. */
export function placeWords(
  place: ContainerPlace | undefined,
  labels: ReadonlyMap<string, string>,
): string {
  if (!place) return 'Not known';
  if ('location' in place) return labels.get(place.location) ?? 'A location';
  return `${labels.get(place.container) ?? 'A box'}, ${place.position}`;
}

const periodWords = (p: { value: string; unit: string }) => formatQuantity(p);

export function storageRangeWords(range: StorageRange): string {
  if (range.min && range.max) return `${formatQuantity(range.min)} to ${formatQuantity(range.max)}`;
  if (range.min) return `at least ${formatQuantity(range.min)}`;
  if (range.max) return `at most ${formatQuantity(range.max)}`;
  return 'any temperature';
}

/** The limit a rule sets, in a few words, e.g. "30 min" or "1 freeze-thaw". */
export function ruleLimit(rule: HandlingRule): string | undefined {
  switch (rule.rule) {
    case 'max_time_out_of_storage':
    case 'use_within':
    case 'stable_after_opening':
      return periodWords(rule.period);
    case 'stable_after_preparation':
      return `${periodWords(rule.period)}${rule.at ? ` at ${storageRangeWords(rule.at)}` : ''}`;
    case 'equilibrate':
    case 'reconstitute':
      return rule.period ? `rest ${periodWords(rule.period)}` : undefined;
    case 'freeze_thaw_limit':
      return rule.cycles === 0
        ? 'do not refreeze'
        : `${rule.cycles} freeze-thaw${rule.cycles === 1 ? '' : 's'}`;
    case 'keep_cold':
    case 'thaw':
      return rule.at ? storageRangeWords(rule.at) : undefined;
    case 'read_within':
      return [
        rule.min && `from ${periodWords(rule.min)}`,
        rule.max && `within ${periodWords(rule.max)}`,
      ]
        .filter(Boolean)
        .join(' ');
    default:
      return undefined;
  }
}

export const ruleTitle: Record<HandlingRule['rule'], string> = {
  max_time_out_of_storage: 'Time out of storage',
  keep_cold: 'Keep cold',
  protect_from_light: 'Protect from light',
  freeze_thaw_limit: 'Freeze-thaw limit',
  use_within: 'Use within',
  stable_after_opening: 'Stable after opening',
  stable_after_preparation: 'Stable after preparation',
  read_within: 'Read within',
  thaw: 'Thaw',
  equilibrate: 'Equilibrate',
  reconstitute: 'Reconstitute',
  mix_before_use: 'Mix before use',
  hygroscopic: 'Hygroscopic',
  advice: 'Advice',
};

const originNoun = { product: 'reagent', entity: '', entity_kind: 'kind' } as const;
const sourceNoun = { vendor: 'vendor', lab_convention: 'lab convention', lab_memory: 'lab memory' };

/** Where an effective rule comes from: "HEK293 (lab convention), Cell line kind (lab convention)". */
export function ruleSources(rule: EffectiveRule): string {
  return rule.from
    .map((f) => {
      const noun = originNoun[f.origin.kind];
      return `${f.origin.label}${noun ? ` ${noun}` : ''} (${sourceNoun[f.rule.source.from]})`;
    })
    .join(', ');
}

/** The wells a rule reaches as blocks, or undefined when it reaches every filled well. */
export function ruleWells(rule: EffectiveRule, filled: number): string | undefined {
  const blocks = [...new Set(rule.from.flatMap((f) => f.wells))];
  const wells = new Set<string>();
  for (const b of blocks) {
    const [first, last] = b.split(':');
    const a = parseWellName(first as string);
    const z = last ? parseWellName(last) : a;
    for (let r = Math.min(a.row, z.row); r <= Math.max(a.row, z.row); r++) {
      for (let c = Math.min(a.column, z.column); c <= Math.max(a.column, z.column); c++) {
        wells.add(`${r}:${c}`);
      }
    }
  }
  return wells.size >= filled ? undefined : blocks.join(', ');
}
