import type { Quantity } from '@ailab/schema';
import { LabDecimal, toDecimalString } from './decimal.ts';
import { expandWells, LabwareError, parseWellName, wellName } from './labware.ts';

/**
 * Plate maps (plan 014): what goes in which well. A layout says which roles go where and how
 * (regions, replicates, fill order, placement strategy, edges, leftovers); `generatePlateMap`
 * applies it to real subjects across as many plates as needed. Pure and deterministic: the same
 * layout, subjects and seed always give the same map.
 */

export class PlateMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlateMapError';
  }
}

export interface PlateFormat {
  rows: number;
  columns: number;
}

const FORMATS: Record<number, PlateFormat> = {
  6: { rows: 2, columns: 3 },
  12: { rows: 3, columns: 4 },
  24: { rows: 4, columns: 6 },
  48: { rows: 6, columns: 8 },
  96: { rows: 8, columns: 12 },
  384: { rows: 16, columns: 24 },
  1536: { rows: 32, columns: 48 },
};

/** The grid of a standard plate by its well count (96 → 8 × 12). */
export function plateFormat(wells: number): PlateFormat {
  const format = FORMATS[wells];
  if (!format) {
    throw new PlateMapError(
      `${wells} wells is not a standard plate; use ${Object.keys(FORMATS).join(', ')}`,
    );
  }
  return format;
}

export type FillOrder = 'row' | 'column';

/** Every well of a format in fill order: row runs A1, A2…; column runs A1, B1…. */
export function allWells(format: PlateFormat, order: FillOrder = 'row'): string[] {
  const out: string[] = [];
  const [outer, inner] =
    order === 'row' ? [format.rows, format.columns] : [format.columns, format.rows];
  for (let i = 0; i < outer; i++) {
    for (let j = 0; j < inner; j++) {
      out.push(order === 'row' ? wellName(i, j) : wellName(j, i));
    }
  }
  return out;
}

/** Sorts well names in fill order. */
export function sortWells(wells: readonly string[], order: FillOrder): string[] {
  return [...wells].sort((a, b) => {
    const p = parseWellName(a);
    const q = parseWellName(b);
    return order === 'row'
      ? p.row - q.row || p.column - q.column
      : p.column - q.column || p.row - q.row;
  });
}

/** The outermost ring of wells. */
export function edgeWells(format: PlateFormat): string[] {
  return allWells(format).filter((name) => {
    const { row, column } = parseWellName(name);
    return row === 0 || column === 0 || row === format.rows - 1 || column === format.columns - 1;
  });
}

const range = (spec: string, parse: (part: string) => number): number[] => {
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((x) => x.trim());
    const from = parse(a as string);
    const to = b === undefined ? from : parse(b);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) out.push(i);
  }
  return out;
};

const rowIndex = (letters: string) => parseWellName(`${letters}1`).row;

/**
 * Reads one region in lab words into wells, row by row: "A1", "A1:H2", "column 1",
 * "columns 1-2, 23", "row H", "rows A-B", "edge" or "all".
 */
export function parseRegion(spec: string, format: PlateFormat): string[] {
  const text = spec.trim();
  const available = allWells(format);
  const size = `${format.rows * format.columns}-well plate`;
  const lower = text.toLowerCase();
  if (lower === 'all') return available;
  if (lower === 'edge' || lower === 'edges') return edgeWells(format);
  const columns = /^columns?\s+(.+)$/i.exec(text);
  if (columns) {
    const picked = range(columns[1] as string, (x) => {
      const n = Number(x);
      if (!Number.isInteger(n) || n < 1) throw new PlateMapError(`"${x}" is not a column number`);
      if (n > format.columns) throw new PlateMapError(`A ${size} has no column ${n} (${spec})`);
      return n - 1;
    });
    return available.filter((w) => picked.includes(parseWellName(w).column));
  }
  const rows = /^rows?\s+(.+)$/i.exec(text);
  if (rows) {
    const picked = range(rows[1] as string, (x) => {
      let row: number;
      try {
        row = rowIndex(x.toUpperCase());
      } catch {
        throw new PlateMapError(`"${x}" is not a row letter`);
      }
      if (row >= format.rows) throw new PlateMapError(`A ${size} has no row ${x} (${spec})`);
      return row;
    });
    return available.filter((w) => picked.includes(parseWellName(w).row));
  }
  try {
    return expandWells([text], available);
  } catch (error) {
    if (error instanceof LabwareError) throw new PlateMapError(`${error.message} (${spec})`);
    throw error;
  }
}

/** A dilution series (M2): what, top concentration, factor, points, direction. */
export interface SeriesSpec {
  top: Quantity;
  /** Fold between points, e.g. "3" for 3-fold. */
  factor: string;
  points: number;
  /** down: top first. up: lowest first. */
  direction?: 'down' | 'up' | undefined;
}

/** The concentrations of a series, 6 significant digits: 10 µM 3-fold × 4 → 10, 3.33333, 1.11111, 0.37037. */
export function seriesConcentrations(series: SeriesSpec): Quantity[] {
  if (!Number.isInteger(series.points) || series.points < 1) {
    throw new PlateMapError('A series needs at least one point');
  }
  const factor = new LabDecimal(series.factor);
  if (!factor.greaterThan(1))
    throw new PlateMapError('A series factor is above 1, e.g. 3 for 3-fold');
  const out: Quantity[] = [];
  let value = new LabDecimal(series.top.value);
  for (let i = 0; i < series.points; i++) {
    out.push({ value: toDecimalString(value.toSignificantDigits(6)), unit: series.top.unit });
    value = value.dividedBy(factor);
  }
  return series.direction === 'up' ? out.reverse() : out;
}

export type ReplicateArrangement = 'side_by_side' | 'down_column' | 'another_plate';
export type Strategy = 'in_order' | 'randomized_within_plate' | 'balanced_across_plates';

/** Something placed: a subject (sample, compound, standard) with its optional series. */
export interface Placed {
  /** How the map names it, e.g. an entity ID or "std". */
  subject: string;
  label?: string;
  series?: SeriesSpec;
  concentration?: Quantity;
}

/** A region repeated on every plate: controls, blanks, standards (M3). */
export interface FixedRegion {
  role: string;
  region: string[];
  label?: string;
  /** Fills the region: one subject in every well, or a series point by point (a standard curve). */
  subject?: Placed;
  replicates?: number;
}

export interface LayoutSpec {
  format: PlateFormat;
  /** Where subjects go; defaults to every well not in a fixed region. */
  subjectRegion?: string[];
  subjectRole: string;
  fixed?: FixedRegion[];
  replicates?: number;
  arrangement?: ReplicateArrangement;
  fillOrder?: FillOrder;
  strategy?: Strategy;
  edge?: 'use' | 'empty' | 'buffer';
  /** What fills subject wells left over on a plate. */
  leftover?: 'empty' | 'neutral_control' | 'buffer';
}

export interface WellOverride {
  plate: number;
  well: string;
  role: string;
  subject?: string;
  label?: string;
}

export interface WellPlan {
  well: string;
  role: string;
  subject?: string;
  label?: string;
  replicate?: number;
  /** 1-based point of a series. */
  point?: number;
  concentration?: Quantity;
  override?: true;
}

export interface PlatePlan {
  plate: number;
  wells: WellPlan[];
}

export interface PlateMapResult {
  plates: PlatePlan[];
  /** Subjects that fit on one plate. */
  perPlate: number;
  /** Overrides that no longer land on a plate of the map (P4). */
  staleOverrides: WellOverride[];
}

/** A small seeded generator (mulberry32), so a randomized map can be rebuilt exactly. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Groups a region's wells into cells of `size` wells for replicates: side by side in a row, or
 * down a column. Cells are ordered by the fill order of their first well; wells that don't make a
 * whole cell are left over.
 */
export function replicateCells(
  wells: readonly string[],
  size: number,
  arrangement: ReplicateArrangement,
  order: FillOrder,
): { cells: string[][]; leftover: string[] } {
  if (size <= 1 || arrangement === 'another_plate') {
    return { cells: sortWells(wells, order).map((w) => [w]), leftover: [] };
  }
  const lines = new Map<number, string[]>();
  for (const w of wells) {
    const { row, column } = parseWellName(w);
    const key = arrangement === 'side_by_side' ? row : column;
    lines.set(key, [...(lines.get(key) ?? []), w]);
  }
  const cells: string[][] = [];
  const leftover: string[] = [];
  for (const line of lines.values()) {
    const sorted = sortWells(line, arrangement === 'side_by_side' ? 'row' : 'column');
    for (let i = 0; i + size <= sorted.length; i += size) cells.push(sorted.slice(i, i + size));
    leftover.push(...sorted.slice(sorted.length - (sorted.length % size)));
  }
  const first = new Map(cells.map((c) => [c, c[0] as string]));
  const order_ = sortWells([...first.values()], order);
  const rank = new Map(order_.map((w, i) => [w, i]));
  cells.sort((a, b) => (rank.get(a[0] as string) ?? 0) - (rank.get(b[0] as string) ?? 0));
  return { cells, leftover };
}

interface Unit {
  subject: Placed;
  point?: number;
  concentration?: Quantity;
}

function unitsOf(placed: readonly Placed[]): Unit[] {
  return placed.flatMap((p) =>
    p.series
      ? seriesConcentrations(p.series).map((concentration, i) => ({
          subject: p,
          point: i + 1,
          concentration,
        }))
      : [{ subject: p, ...(p.concentration ? { concentration: p.concentration } : {}) }],
  );
}

function wellOf(well: string, role: string, unit: Unit, replicate?: number): WellPlan {
  return {
    well,
    role,
    subject: unit.subject.subject,
    ...(unit.subject.label ? { label: unit.subject.label } : {}),
    ...(replicate !== undefined ? { replicate } : {}),
    ...(unit.point !== undefined ? { point: unit.point } : {}),
    ...(unit.concentration ? { concentration: unit.concentration } : {}),
  };
}

/**
 * Applies a layout to subjects: fixed regions on every plate, subjects paged across plates with
 * their replicates, the strategy applied with its seed, edges and leftovers filled, then hand
 * overrides on top.
 */
export function generatePlateMap(
  layout: LayoutSpec,
  subjects: readonly Placed[],
  options: { seed?: number; overrides?: readonly WellOverride[] } = {},
): PlateMapResult {
  const { format } = layout;
  const order = layout.fillOrder ?? 'row';
  const replicates = layout.replicates ?? 1;
  const arrangement = layout.arrangement ?? 'side_by_side';
  const strategy = layout.strategy ?? 'in_order';
  if (!Number.isInteger(replicates) || replicates < 1)
    throw new PlateMapError('Replicates are a whole number from 1');
  if (strategy !== 'in_order' && options.seed === undefined)
    throw new PlateMapError(`The ${strategy.replaceAll('_', ' ')} strategy needs a seed`);

  // Fixed regions, checked for overlaps.
  const taken = new Map<string, string>();
  const fixed = (layout.fixed ?? []).map((f) => {
    const wells = f.region.flatMap((r) => parseRegion(r, format));
    for (const w of wells) {
      const other = taken.get(w);
      if (other) throw new PlateMapError(`${w} is in both ${other} and ${f.label ?? f.role}`);
      taken.set(w, f.label ?? f.role);
    }
    return { ...f, wells };
  });
  const edges = new Set(edgeWells(format));
  const leaveEdges = (layout.edge ?? 'use') !== 'use';
  const subjectWells = (
    layout.subjectRegion
      ? layout.subjectRegion.flatMap((r) => parseRegion(r, format))
      : allWells(format).filter((w) => !taken.has(w))
  ).filter((w) => !(leaveEdges && edges.has(w)));
  for (const w of subjectWells) {
    const other = taken.get(w);
    if (other)
      throw new PlateMapError(`${w} is in both ${other} and the ${layout.subjectRole} wells`);
  }
  const { cells, leftover: partial } = replicateCells(subjectWells, replicates, arrangement, order);
  if (subjects.length > 0 && cells.length === 0) {
    throw new PlateMapError(
      `No room for ${layout.subjectRole} wells in ${replicates} replicates ${arrangement.replaceAll('_', ' ')}`,
    );
  }

  // A subject's series stays on one plate: plates take whole subjects.
  const groups = subjects.map((subject) => unitsOf([subject]));
  const size = Math.max(1, ...groups.map((g) => g.length));
  const perPlate = Math.floor(cells.length / size);
  if (subjects.length > 0 && perPlate === 0) {
    throw new PlateMapError(
      `A series of ${size} points${replicates > 1 ? ` × ${replicates} replicates` : ''} doesn't fit the ${layout.subjectRole} wells of one plate`,
    );
  }
  const copies = arrangement === 'another_plate' ? replicates : 1;
  const platesPerCopy = Math.max(1, Math.ceil(groups.length / Math.max(perPlate, 1)));
  const random = options.seed === undefined ? undefined : seededRandom(options.seed);

  // Which subjects go on which plate of a copy.
  const pages: Unit[][] = Array.from({ length: platesPerCopy }, () => []);
  groups.forEach((group, i) => {
    const page =
      strategy === 'balanced_across_plates' ? i % platesPerCopy : Math.floor(i / perPlate);
    pages[page]?.push(...group);
  });

  const plates: PlatePlan[] = [];
  for (let copy = 0; copy < copies; copy++) {
    for (let p = 0; p < platesPerCopy; p++) {
      const plan = new Map<string, WellPlan>();
      for (const f of fixed) {
        const fixedUnits = f.subject ? unitsOf([f.subject]) : [];
        const size = f.replicates ?? 1;
        const { cells: fixedCells } = replicateCells(
          f.wells,
          size,
          arrangement === 'another_plate' ? 'side_by_side' : arrangement,
          order,
        );
        f.wells.forEach((w) => {
          plan.set(w, { well: w, role: f.role, ...(f.label ? { label: f.label } : {}) });
        });
        if (f.subject && fixedUnits.length > 1) {
          if (fixedUnits.length > fixedCells.length) {
            throw new PlateMapError(
              `${f.label ?? f.role} has ${fixedUnits.length} points × ${size} but room for ${fixedCells.length}`,
            );
          }
          fixedUnits.forEach((unit, i) => {
            (fixedCells[i] ?? []).forEach((w, r) => {
              plan.set(w, {
                ...wellOf(w, f.role, unit, size > 1 ? r + 1 : undefined),
                ...(f.label ? { label: f.label } : {}),
              });
            });
          });
        } else if (f.subject) {
          const unit = fixedUnits[0] as Unit;
          f.wells.forEach((w) => {
            plan.set(w, { ...wellOf(w, f.role, unit), ...(f.label ? { label: f.label } : {}) });
          });
        }
      }
      const page = pages[p] ?? [];
      const slots =
        strategy === 'randomized_within_plate' && random
          ? shuffle(cells.slice(0, page.length), random)
          : cells.slice(0, page.length);
      page.forEach((unit, i) => {
        const cell = slots[i] as string[];
        cell.forEach((w, r) => {
          const replicate = arrangement === 'another_plate' ? copy + 1 : r + 1;
          plan.set(w, wellOf(w, layout.subjectRole, unit, replicates > 1 ? replicate : undefined));
        });
      });
      const fill = layout.leftover ?? 'empty';
      for (const w of [...cells.slice(page.length).flat(), ...partial]) {
        plan.set(w, { well: w, role: fill });
      }
      for (const w of allWells(format)) {
        if (plan.has(w)) continue;
        plan.set(w, {
          well: w,
          role: leaveEdges && edges.has(w) ? (layout.edge as string) : 'empty',
        });
      }
      plates.push({
        plate: plates.length + 1,
        wells: sortWells([...plan.keys()], 'row').map((w) => plan.get(w) as WellPlan),
      });
    }
  }

  const staleOverrides: WellOverride[] = [];
  for (const o of options.overrides ?? []) {
    const plate = plates.find((x) => x.plate === o.plate);
    const i = plate?.wells.findIndex((w) => w.well === o.well) ?? -1;
    if (!plate || i < 0) {
      staleOverrides.push(o);
      continue;
    }
    plate.wells[i] = {
      well: o.well,
      role: o.role,
      ...(o.subject ? { subject: o.subject } : {}),
      ...(o.label ? { label: o.label } : {}),
      override: true,
    };
  }
  return { plates, perPlate, staleOverrides };
}
