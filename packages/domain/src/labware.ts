import type {
  ComputedWell,
  Footprint,
  Millimetres,
  WellGeometry,
  WellLayout,
  WellSection,
} from '@ailab/schema';

/**
 * Labware geometry (plan 007): well names, the computed well list, SBS rules and liquid height in a
 * well. Geometry is in mm; 1 mm³ is 1 µL.
 */

export class LabwareError extends Error {
  constructor(
    readonly code: 'invalid_well' | 'not_modelled' | 'unsupported',
    message: string,
  ) {
    super(message);
    this.name = 'LabwareError';
  }
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Row letters: A to Z, then AA to AF (1536-well plates have 32 rows). */
export function rowLabel(row: number): string {
  if (!Number.isInteger(row) || row < 0 || row > 31) {
    throw new LabwareError('invalid_well', `Row ${row + 1} is outside A to AF`);
  }
  return row < 26 ? (LETTERS[row] as string) : `A${LETTERS[row - 26]}`;
}

/** Canonical well name, e.g. (0, 0) → "A1", (31, 47) → "AF48". Rows and columns count from 0. */
export function wellName(row: number, column: number): string {
  if (!Number.isInteger(column) || column < 0 || column > 47) {
    throw new LabwareError('invalid_well', `Column ${column + 1} is outside 1 to 48`);
  }
  return `${rowLabel(row)}${column + 1}`;
}

/** Reads a well name in any common spelling ("A1", "a01", "AF48") into a row and column from 0. */
export function parseWellName(name: string): { row: number; column: number } {
  const match = /^([A-Za-z]{1,2})0*(\d{1,2})$/.exec(name.trim());
  if (!match) throw new LabwareError('invalid_well', `"${name}" is not a well name like A1`);
  const letters = (match[1] as string).toUpperCase();
  const row =
    letters.length === 1
      ? LETTERS.indexOf(letters)
      : letters[0] === 'A'
        ? 26 + LETTERS.indexOf(letters[1] as string)
        : -1;
  const column = Number(match[2]) - 1;
  if (row < 0 || row > 31 || column < 0 || column > 47) {
    throw new LabwareError('invalid_well', `"${name}" is outside A1 to AF48`);
  }
  return { row, column };
}

const mm = (value: number): Millimetres => ({ value: round(value), unit: 'mm' });

/** Rounds to 3 decimals (1 µm), as a decimal string without trailing zeros. */
function round(value: number): string {
  const fixed = value.toFixed(3).replace(/\.?0+$/, '');
  return fixed === '-0' ? '0' : fixed;
}

const num = (q: Millimetres): number => Number(q.value);

/**
 * Every well of a layout with its position when known. `order` "column" runs A1, B1, C1… (the order
 * liquid handlers and Opentrons use); "row" runs A1, A2, A3….
 */
export function computeWells(
  layout: WellLayout,
  order: 'column' | 'row' = 'column',
): ComputedWell[] {
  const wells: ComputedWell[] =
    layout.layout === 'grid'
      ? gridWells(layout)
      : layout.wells.map((w) => {
          const { row, column } = parseWellName(w.name);
          return {
            name: wellName(row, column),
            row,
            column,
            x: w.x,
            y: w.y,
            ...(w.topHeight ? { topHeight: w.topHeight } : {}),
            well: w.well,
          };
        });
  return wells.sort((a, b) =>
    order === 'column'
      ? a.column - b.column || a.row - b.row
      : a.row - b.row || a.column - b.column,
  );
}

function gridWells(layout: Extract<WellLayout, { layout: 'grid' }>): ComputedWell[] {
  const wells: ComputedWell[] = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let column = 0; column < layout.columns; column++) {
      const at =
        layout.a1 && (layout.pitch || (layout.rows === 1 && layout.columns === 1))
          ? {
              x: mm(num(layout.a1.x) + column * (layout.pitch ? num(layout.pitch) : 0)),
              y: mm(num(layout.a1.y) + row * (layout.pitch ? num(layout.pitch) : 0)),
            }
          : {};
      wells.push({
        name: wellName(row, column),
        row,
        column,
        ...at,
        ...(layout.topHeight ? { topHeight: layout.topHeight } : {}),
        ...(layout.well ? { well: layout.well } : {}),
      });
    }
  }
  return wells;
}

/** The ANSI/SLAS 1-2004 microplate footprint and its tolerance. */
export const SBS_FOOTPRINT = { length: 127.76, width: 85.48, tolerance: 0.25 } as const;

/** Why a footprint marked SBS isn't one, or undefined when it fits (or its size is unknown). */
export function sbsFootprintProblem(footprint: Footprint): string | undefined {
  if (!footprint.sbs || !footprint.length || !footprint.width) return undefined;
  const length = num(footprint.length);
  const width = num(footprint.width);
  const off = (actual: number, expected: number) =>
    Math.abs(actual - expected) > SBS_FOOTPRINT.tolerance + 1e-9;
  if (!off(length, SBS_FOOTPRINT.length) && !off(width, SBS_FOOTPRINT.width)) return undefined;
  return `${round(length)} × ${round(width)} mm is not ${SBS_FOOTPRINT.length} × ${SBS_FOOTPRINT.width} mm (± ${SBS_FOOTPRINT.tolerance} mm)`;
}

/** ANSI/SLAS 4-2004 well spacing for standard SBS well counts, in mm; undefined for other grids. */
export function sbsPitch(rows: number, columns: number): number | undefined {
  if (rows === 8 && columns === 12) return 9;
  if (rows === 16 && columns === 24) return 4.5;
  if (rows === 32 && columns === 48) return 2.25;
  // Single-row reservoirs with 8, 12 or 24 troughs follow the plate's column spacing.
  if (rows === 1 && columns === 12) return 9;
  if (rows === 1 && columns === 24) return 4.5;
  if (rows === 8 && columns === 1) return 9;
  return undefined;
}

/** Why a grid's wells don't fit inside the footprint, or undefined when they do (or it can't tell). */
export function gridFitProblem(layout: WellLayout, footprint: Footprint): string | undefined {
  if (!footprint.length || !footprint.width) return undefined;
  const length = num(footprint.length);
  const width = num(footprint.width);
  for (const well of computeWells(layout)) {
    if (!well.x || !well.y) return undefined;
    const half = well.well?.top ? halfSize(well.well.top) : { x: 0, y: 0 };
    const x = num(well.x);
    const y = num(well.y);
    if (x - half.x < 0 || x + half.x > length || y - half.y < 0 || y + half.y > width) {
      return `Well ${well.name} at ${round(x)}, ${round(y)} mm lies outside the ${round(length)} × ${round(width)} mm footprint`;
    }
  }
  return undefined;
}

function halfSize(section: WellSection): { x: number; y: number } {
  return section.shape === 'circular'
    ? { x: num(section.diameter) / 2, y: num(section.diameter) / 2 }
    : { x: num(section.xSize) / 2, y: num(section.ySize) / 2 };
}

/** A flat-bottomed well's size at a height above its bottom, as a cross-section area in mm². */
function modelled(well: WellGeometry): (height: number) => number {
  const { top, depth } = well;
  if (!top || !depth) {
    throw new LabwareError('not_modelled', 'The well needs its top size and depth');
  }
  if (well.bottom !== 'flat') {
    // Round and V bottoms need their bottom profile, which datasheets rarely give; not modelled yet.
    throw new LabwareError('not_modelled', 'Only flat-bottomed wells are modelled so far');
  }
  const base = well.base ?? top;
  if (base.shape !== top.shape) {
    throw new LabwareError('not_modelled', 'The top and base of a well must have the same shape');
  }
  const d = num(depth);
  if (top.shape === 'circular' && base.shape === 'circular') {
    const rt = num(top.diameter) / 2;
    const rb = num(base.diameter) / 2;
    return (h) => {
      const r = rb + ((rt - rb) * h) / d;
      return Math.PI * r * r;
    };
  }
  if (top.shape === 'rectangular' && base.shape === 'rectangular') {
    const [xt, yt, xb, yb] = [top.xSize, top.ySize, base.xSize, base.ySize].map(num) as [
      number,
      number,
      number,
      number,
    ];
    return (h) => (xb + ((xt - xb) * h) / d) * (yb + ((yt - yb) * h) / d);
  }
  throw new LabwareError('not_modelled', 'Unknown well shape');
}

/** Liquid volume in µL filling a flat-bottomed well to `height` mm (Simpson's rule: exact for frustums). */
export function volumeAtHeight(well: WellGeometry, height: number): number {
  const area = modelled(well);
  const depth = num(well.depth as Millimetres);
  const h = Math.min(Math.max(height, 0), depth);
  return (h / 6) * (area(0) + 4 * area(h / 2) + area(h));
}

/** The full geometric volume of a flat-bottomed well in µL. */
export function wellCapacity(well: WellGeometry): number {
  modelled(well);
  return volumeAtHeight(well, num(well.depth as Millimetres));
}

/** Liquid height in mm for `volume` µL in a flat-bottomed well; refuses volumes that overflow it. */
export function heightForVolume(well: WellGeometry, volume: number): number {
  const capacity = wellCapacity(well);
  const depth = num(well.depth as Millimetres);
  if (volume < 0 || volume > capacity * (1 + 1e-9)) {
    throw new LabwareError(
      'not_modelled',
      `${round(volume)} µL does not fit a well that holds ${round(capacity)} µL`,
    );
  }
  let low = 0;
  let high = depth;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (volumeAtHeight(well, mid) < volume) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
