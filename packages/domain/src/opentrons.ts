import type {
  LabwareFamily,
  LabwareTypeAttributes,
  Millimetres,
  OpentronsDefinition,
  WellGeometry,
  WellLayout,
} from '@ailab/schema';
import { computeWells, LabwareError, parseWellName, wellName } from './labware.ts';
import { convert } from './units.ts';

/**
 * Opentrons labware definitions (schema version 2) to and from labware type attributes (ADR 0023).
 * Opentrons measures y from the front edge and z up from the bottom; we measure y from the back edge
 * and give each well its depth.
 */

type OpentronsWell = OpentronsDefinition['wells'][string];

const TOLERANCE = 0.01;

const mm = (value: number): Millimetres => ({
  value: String(Number(value.toFixed(3))),
  unit: 'mm',
});
const num = (q: Millimetres): number => Number(q.value);

const families: Record<string, LabwareFamily> = {
  wellPlate: 'plate',
  reservoir: 'reservoir',
  tubeRack: 'rack',
  aluminumBlock: 'rack',
  tipRack: 'tip_rack',
};

const bottoms = { flat: 'flat', u: 'round', v: 'v' } as const;

export interface ImportedLabware {
  label: string;
  /** The brand as Opentrons names it, e.g. "Corning"; the caller matches it to a vendor record. */
  brand: string;
  attributes: Omit<LabwareTypeAttributes, 'manufacturer'>;
}

/** Reads an Opentrons definition. Refuses what isn't labware in our sense (trash, adapters, lids). */
export function fromOpentrons(definition: OpentronsDefinition): ImportedLabware {
  const { metadata, parameters, dimensions, brand } = definition;
  const family = parameters.isTiprack ? 'tip_rack' : families[metadata.displayCategory];
  if (!family) {
    throw new LabwareError(
      'unsupported',
      `Opentrons "${metadata.displayCategory}" definitions can't be imported as labware; plates, reservoirs, tube racks, aluminum blocks and tip racks can`,
    );
  }
  const bottomOf = new Map<string, 'flat' | 'round' | 'v'>();
  for (const group of definition.groups) {
    const shape = group.metadata.wellBottomShape;
    if (shape) for (const name of group.wells) bottomOf.set(name, bottoms[shape]);
  }
  const names = definition.ordering.flat();
  const wellOf = (name: string): OpentronsWell => {
    const well = definition.wells[name];
    if (!well)
      throw new LabwareError('invalid_well', `Well ${name} is in the ordering but not defined`);
    return well;
  };
  const geometryOf = (name: string): WellGeometry => {
    const w = wellOf(name);
    const top =
      w.shape === 'circular'
        ? w.diameter === undefined
          ? undefined
          : { shape: 'circular' as const, diameter: mm(w.diameter) }
        : w.xDimension === undefined || w.yDimension === undefined
          ? undefined
          : { shape: 'rectangular' as const, xSize: mm(w.xDimension), ySize: mm(w.yDimension) };
    const bottom = bottomOf.get(name);
    return { ...(top ? { top } : {}), depth: mm(w.depth), ...(bottom ? { bottom } : {}) };
  };
  const volumes = names.map((n) => wellOf(n).totalLiquidVolume);
  const maxVolume = Math.max(...volumes);
  const tipLength = parameters.tipLength;
  const [catalogNumber, ...others] = brand.brandId.filter((id) => id.trim() !== '');

  const attributes: ImportedLabware['attributes'] = {
    family,
    ...(catalogNumber ? { catalogNumber } : {}),
    ...(others.length ? { otherCatalogNumbers: others } : {}),
    footprint: {
      sbs:
        Math.abs(dimensions.xDimension - 127.76) <= 0.5 &&
        Math.abs(dimensions.yDimension - 85.48) <= 0.5,
      length: mm(dimensions.xDimension),
      width: mm(dimensions.yDimension),
      height: mm(dimensions.zDimension),
    },
    wells: layoutOf(definition, names, geometryOf),
    ...(family === 'tip_rack' ? { tip: tipLength ? { length: mm(tipLength) } : {} } : {}),
    ...(maxVolume > 0 ? { maxVolume: { value: String(maxVolume), unit: 'uL' as const } } : {}),
    opentronsLoadName: parameters.loadName,
    ...(volumes.some((v) => v !== maxVolume)
      ? { notes: 'Wells hold different volumes in the Opentrons definition; the largest is shown.' }
      : {}),
  };
  return { label: metadata.displayName, brand: brand.brand, attributes };
}

/** A regular grid when the wells are evenly spaced and all alike, otherwise every well listed. */
function layoutOf(
  definition: OpentronsDefinition,
  names: string[],
  geometryOf: (name: string) => WellGeometry,
): WellLayout {
  const { ordering, dimensions } = definition;
  const columns = ordering.length;
  const rows = ordering[0]?.length ?? 0;
  const at = (name: string) => definition.wells[name] as OpentronsWell;
  const sameGeometry = (a: string, b: string) => {
    const [p, q] = [at(a), at(b)];
    return (
      p.shape === q.shape &&
      p.depth === q.depth &&
      p.z === q.z &&
      p.diameter === q.diameter &&
      p.xDimension === q.xDimension &&
      p.yDimension === q.yDimension &&
      JSON.stringify(geometryOf(a)) === JSON.stringify(geometryOf(b))
    );
  };
  const first = ordering[0]?.[0] as string;
  const a1 = at(first);
  const pitchX = columns > 1 ? at(ordering[1]?.[0] as string).x - a1.x : undefined;
  const pitchY = rows > 1 ? a1.y - at(ordering[0]?.[1] as string).y : undefined;
  const pitch = pitchX ?? pitchY;
  const regular =
    first === 'A1' &&
    ordering.every((column) => column.length === rows) &&
    (pitchX === undefined || pitchY === undefined || Math.abs(pitchX - pitchY) < TOLERANCE) &&
    ordering.every((column, c) =>
      column.every((name, r) => {
        const expected = safeName(r, c);
        const w = at(name);
        return (
          name === expected &&
          sameGeometry(first, name) &&
          Math.abs(w.x - (a1.x + c * (pitch ?? 0))) < TOLERANCE &&
          Math.abs(w.y - (a1.y - r * (pitch ?? 0))) < TOLERANCE
        );
      }),
    );
  const topOf = (w: OpentronsWell) =>
    Math.abs(w.z + w.depth - dimensions.zDimension) > TOLERANCE
      ? { topHeight: mm(w.z + w.depth) }
      : {};
  if (regular) {
    return {
      layout: 'grid',
      rows,
      columns,
      ...(pitch !== undefined ? { pitch: mm(pitch) } : {}),
      a1: { x: mm(a1.x), y: mm(dimensions.yDimension - a1.y) },
      ...topOf(a1),
      well: geometryOf(first),
    };
  }
  return {
    layout: 'explicit',
    wells: names.map((name) => {
      const { row, column } = parseWellName(name);
      const w = at(name);
      return {
        name: wellName(row, column),
        x: mm(w.x),
        y: mm(dimensions.yDimension - w.y),
        ...topOf(w),
        well: geometryOf(name),
      };
    }),
  };
}

function safeName(row: number, column: number): string | undefined {
  try {
    return wellName(row, column);
  } catch {
    return undefined;
  }
}

const categories: Partial<Record<LabwareFamily, string>> = {
  plate: 'wellPlate',
  reservoir: 'reservoir',
  rack: 'tubeRack',
  tip_rack: 'tipRack',
};

/**
 * Writes a type as an Opentrons definition in the "custom_beta" namespace. Refuses types whose
 * geometry isn't complete, naming what is missing.
 */
export function toOpentrons(
  attributes: LabwareTypeAttributes,
  names: { label: string; brand?: string | undefined },
): OpentronsDefinition {
  const category = categories[attributes.family];
  if (!category) {
    throw new LabwareError(
      'unsupported',
      `A ${attributes.family.replace('_', ' ')} can't be exported on its own; Opentrons defines plates, reservoirs, racks and tip racks`,
    );
  }
  const missing: string[] = [];
  const { footprint, wells, maxVolume } = attributes;
  if (!footprint?.length || !footprint.width || !footprint.height) missing.push('outer size');
  if (!wells) missing.push('well layout');
  if (!maxVolume) missing.push('maximum volume');
  if (attributes.family === 'tip_rack' && !attributes.tip?.length) missing.push('tip length');
  const computed = wells ? computeWells(wells) : [];
  if (computed.some((w) => !w.x || !w.y)) missing.push('well positions');
  if (computed.some((w) => !w.well?.top || !w.well.depth)) missing.push('well size and depth');
  if (missing.length || !footprint?.length || !footprint.width || !footprint.height || !maxVolume) {
    throw new LabwareError('not_modelled', `Can't export yet: ${missing.join(', ')} missing`);
  }
  const width = num(footprint.width);
  const height = num(footprint.height);
  const volume = Number(convert(maxVolume, 'uL').value);

  const definitionWells: OpentronsDefinition['wells'] = {};
  const ordering: string[][] = [];
  const bottomsOf = new Map<string, string[]>();
  for (const w of computed) {
    const top = w.well?.top;
    const depthQ = w.well?.depth;
    if (!top || !depthQ) throw new LabwareError('not_modelled', `Well ${w.name} has no size`);
    const depth = num(depthQ);
    definitionWells[w.name] = {
      depth,
      totalLiquidVolume: volume,
      shape: top.shape,
      ...(top.shape === 'circular'
        ? { diameter: num(top.diameter) }
        : { xDimension: num(top.xSize), yDimension: num(top.ySize) }),
      x: num(w.x as Millimetres),
      y: round(width - num(w.y as Millimetres)),
      z: round((w.topHeight ? num(w.topHeight) : height) - depth),
    };
    const column = ordering[w.column] ?? [];
    column.push(w.name);
    ordering[w.column] = column;
    const bottom = w.well?.bottom ? { flat: 'flat', round: 'u', v: 'v' }[w.well.bottom] : '';
    bottomsOf.set(bottom, [...(bottomsOf.get(bottom) ?? []), w.name]);
  }
  const catalog = [attributes.catalogNumber, ...(attributes.otherCatalogNumbers ?? [])].filter(
    (n): n is string => n !== undefined,
  );
  const grid = wells?.layout === 'grid' ? wells : undefined;
  const format =
    grid?.rows === 8 && grid.columns === 12
      ? '96Standard'
      : grid?.rows === 16 && grid.columns === 24
        ? '384Standard'
        : 'irregular';
  return {
    schemaVersion: 2,
    version: 1,
    namespace: 'custom_beta',
    metadata: {
      displayName: names.label,
      displayCategory: category,
      displayVolumeUnits: 'µL',
      tags: [],
    },
    brand: { brand: names.brand ?? 'Unknown', brandId: catalog },
    parameters: {
      format,
      isTiprack: attributes.family === 'tip_rack',
      ...(attributes.tip?.length ? { tipLength: num(attributes.tip.length) } : {}),
      loadName: attributes.opentronsLoadName ?? loadNameFor(names.label),
      isMagneticModuleCompatible: false,
    },
    ordering: ordering.filter((column) => column !== undefined),
    cornerOffsetFromSlot: { x: 0, y: 0, z: 0 },
    dimensions: { xDimension: num(footprint.length), yDimension: width, zDimension: height },
    wells: definitionWells,
    groups: [...bottomsOf].map(([bottom, groupWells]) => ({
      metadata: bottom ? { wellBottomShape: bottom as 'flat' | 'u' | 'v' } : {},
      wells: groupWells,
    })),
  };
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

/** A load name from a label, e.g. "Corning 96 Well Plate 360 µL" → "corning_96_well_plate_360_ul". */
export function loadNameFor(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/µ/g, 'u')
      .replace(/[^a-z0-9.]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'labware'
  );
}
