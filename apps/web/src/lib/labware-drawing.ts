import { computeWells, heightForVolume, SBS_FOOTPRINT, sbsPitch } from '@ailab/domain';
import type {
  LabwareTypeAttributes,
  LiquidVolume,
  Millimetres,
  WellGeometry,
  WellSection,
} from '@ailab/schema';

/**
 * What the labware drawings show, worked out from a labware type's values. Every value the record
 * does not give is still drawn, so the picture is useful on a draft, but it is marked as filled in by
 * the drawing (`drawn`), and `notes` say what to add. Nothing here claims more than the record holds.
 */

const n = (m: Millimetres | undefined) => (m ? Number(m.value) : undefined);

export interface TopView {
  length: number;
  width: number;
  /** The outer size was not given; the standard SBS size is drawn. */
  sizeDrawn: boolean;
  wells: DrawnWell[];
  /** Well positions were not given; they are spread at the standard (or an even) spacing, centred. */
  positionsDrawn: boolean;
  /** Well size was not given; a circle a little smaller than the spacing is drawn. */
  wellSizeDrawn: boolean;
  rows: number;
  columns: number;
  pitch: number | undefined;
  notes: string[];
}

export interface DrawnWell {
  name: string;
  row: number;
  column: number;
  x: number;
  y: number;
  shape: 'circular' | 'rectangular';
  /** Diameter, or the x and y sizes of a rectangular opening. */
  xSize: number;
  ySize: number;
}

function size(section: WellSection | undefined): { xSize: number; ySize: number } | undefined {
  if (!section) return undefined;
  if (section.shape === 'circular') {
    const d = Number(section.diameter.value);
    return { xSize: d, ySize: d };
  }
  return { xSize: Number(section.xSize.value), ySize: Number(section.ySize.value) };
}

/** The labware from above, or why it can't be drawn yet. */
export function topView(a: LabwareTypeAttributes): TopView | { missing: string } {
  const notes: string[] = [];
  const f = a.footprint;
  let length = n(f?.length);
  let width = n(f?.width);
  let sizeDrawn = false;
  if (length === undefined || width === undefined) {
    if (!f?.sbs) return { missing: 'Add the outer length and width to draw it.' };
    length = SBS_FOOTPRINT.length;
    width = SBS_FOOTPRINT.width;
    sizeDrawn = true;
    notes.push('Outer size drawn at the SBS standard, 127.76 × 85.48 mm; it is not in the record.');
  }

  const layout = a.wells;
  if (!layout) return empty();
  const computed = computeWells(layout, 'row');
  const rows = Math.max(...computed.map((w) => w.row)) + 1;
  const columns = Math.max(...computed.map((w) => w.column)) + 1;
  const grid = layout.layout === 'grid' ? layout : undefined;
  const givenPitch = n(grid?.pitch);
  const pitch =
    givenPitch ??
    (grid ? (sbsPitch(rows, columns) ?? Math.min(length / columns, width / rows)) : undefined);
  const positionsDrawn = computed.some((w) => w.x === undefined || w.y === undefined);
  const firstX = n(grid?.a1?.x) ?? (length - (columns - 1) * (pitch ?? 0)) / 2;
  const firstY = n(grid?.a1?.y) ?? (width - (rows - 1) * (pitch ?? 0)) / 2;
  if (positionsDrawn) {
    notes.push(
      givenPitch !== undefined
        ? `Wells drawn at the given ${givenPitch} mm spacing and centred; add the A1 offset for exact positions.`
        : grid && sbsPitch(rows, columns)
          ? `Wells drawn ${pitch} mm apart (the SBS spacing for ${rows} × ${columns}) and centred; add the pitch and A1 offset for exact positions.`
          : 'Wells spread evenly and centred; add the pitch and A1 offset for exact positions.',
    );
  }

  let wellSizeDrawn = false;
  const wells = computed.map((w): DrawnWell => {
    const given = size(w.well?.top);
    if (!given) wellSizeDrawn = true;
    const fallback = (pitch ?? Math.min(length, width) / 2) * 0.7;
    return {
      name: w.name,
      row: w.row,
      column: w.column,
      x: n(w.x) ?? firstX + w.column * (pitch ?? 0),
      y: n(w.y) ?? firstY + w.row * (pitch ?? 0),
      shape: w.well?.top?.shape ?? 'circular',
      xSize: given?.xSize ?? fallback,
      ySize: given?.ySize ?? fallback,
    };
  });
  if (wellSizeDrawn) notes.push('Well openings drawn as circles; their size is not in the record.');
  return {
    length,
    width,
    sizeDrawn,
    wells,
    positionsDrawn,
    wellSizeDrawn,
    rows,
    columns,
    pitch,
    notes,
  };

  function empty(): TopView {
    notes.push('No wells yet.');
    return {
      length: length as number,
      width: width as number,
      sizeDrawn,
      wells: [],
      positionsDrawn: false,
      wellSizeDrawn: false,
      rows: 0,
      columns: 0,
      pitch: undefined,
      notes,
    };
  }
}

export interface Section {
  /** Opening width across the drawing (diameter, or the x size). */
  top: number;
  /** Width at the base (the top width unless the well tapers). */
  base: number;
  depth: number;
  bottom: 'flat' | 'round' | 'v' | undefined;
  /** How far the liquid stands when the well holds its maximum volume (flat wells only). */
  fill?: { height: number; volume: string } | undefined;
  notes: string[];
}

const microlitres: Record<LiquidVolume['unit'], number> = { L: 1e6, mL: 1e3, uL: 1, nL: 1e-3 };

/** One well cut through its centre, or what is missing to draw it. */
export function wellSection(a: LabwareTypeAttributes): Section | { missing: string } {
  const layout = a.wells;
  const well: WellGeometry | undefined =
    layout?.layout === 'grid' ? layout.well : layout?.wells[0]?.well;
  const top = size(well?.top)?.xSize;
  const depth = n(well?.depth);
  if (top === undefined || depth === undefined) {
    return { missing: 'Add the well opening and depth to draw a well.' };
  }
  const base = size(well?.base)?.xSize ?? top;
  const notes: string[] = [];
  let fill: Section['fill'];
  if (a.maxVolume && well?.bottom === 'flat') {
    try {
      const volume = Number(a.maxVolume.value) * microlitres[a.maxVolume.unit];
      fill = {
        height: heightForVolume(well, volume),
        volume: `${a.maxVolume.value} ${a.maxVolume.unit === 'uL' ? 'µL' : a.maxVolume.unit}`,
      };
    } catch (error) {
      notes.push(error instanceof Error ? error.message : String(error));
    }
  } else if (a.maxVolume && well?.bottom !== 'flat') {
    notes.push('Liquid height is worked out for flat-bottomed wells only.');
  }
  if (!well?.bottom) notes.push('Bottom shape not given; drawn flat.');
  return { top, base, depth, bottom: well?.bottom, fill, notes };
}
