import { add, convert, LabDecimal, parseWellName, rowLabel } from '@ailab/domain';
import type {
  Quantity,
  WellNaming,
  WorklistColumn,
  WorklistFormatAttributes,
  WorklistValue,
} from '@ailab/schema';
import { csvCell } from './echo.ts';

/**
 * The generic worklist writer (plan 016c): fills a lab's worklist format record from a group's
 * transfers. Rows formats write one file, a header and a row per transfer in plan order; grid
 * formats write one volume grid per destination plate and source well (one reagent).
 */

export interface WorklistPlate {
  /** The plan's label for it, else its id. */
  name: string;
  /** Its container's name, blank for a plate not made yet. */
  barcode: string;
  /** The type's name in the instrument's software (the Hamilton labware), else the type's name. */
  labware: string;
  /** The labware type's name. */
  type: string;
  rows: number;
  columns: number;
}

export interface WorklistTransfer {
  source: WorklistPlate;
  sourceWell: string;
  destination: WorklistPlate;
  destinationWell: string;
  volume: Quantity;
  newTip: boolean;
  liquidClass: string;
  liquid: string;
}

export interface WorklistFile {
  /** What the file covers, for its name: blank for a rows file, "<plate> <well>" for a grid. */
  part: string;
  text: string;
  rows: number;
}

/** Trailing zeros off a decimal string: "25.000" reads "25". */
const plain = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

/** A well as the format names it. */
export function namedWell(well: string, plate: WorklistPlate, naming: WellNaming = 'name') {
  if (naming === 'name') return well;
  const { row, column } = parseWellName(well);
  return String(
    naming === 'index_by_column' ? column * plate.rows + row + 1 : row * plate.columns + column + 1,
  );
}

function cell(
  column: WorklistColumn,
  t: WorklistTransfer,
  row: number,
  unit: WorklistFormatAttributes['volumeUnit'],
): string {
  const value: Record<WorklistValue, () => string> = {
    row_number: () => String(row),
    source_name: () => t.source.name,
    source_barcode: () => t.source.barcode,
    source_labware: () => t.source.labware,
    source_type: () => t.source.type,
    source_well: () => namedWell(t.sourceWell, t.source, column.wells),
    destination_name: () => t.destination.name,
    destination_barcode: () => t.destination.barcode,
    destination_labware: () => t.destination.labware,
    destination_type: () => t.destination.type,
    destination_well: () => namedWell(t.destinationWell, t.destination, column.wells),
    volume: () => plain(convert(t.volume, unit).value),
    volume_unit: () => unit,
    liquid_class: () => t.liquidClass,
    liquid: () => t.liquid,
    new_tip: () => (t.newTip ? (column.yes ?? '1') : (column.no ?? '0')),
    constant: () => column.text ?? '',
  };
  return value[column.value]();
}

/** The files a format makes of a group's transfers, each ending with a newline. */
export function writeWorklist(
  format: Pick<WorklistFormatAttributes, 'layout' | 'volumeUnit'>,
  transfers: readonly WorklistTransfer[],
): WorklistFile[] {
  const unit = format.volumeUnit;
  const layout = format.layout;
  if (layout.layout === 'rows') {
    const lines = [
      layout.columns.map((c) => csvCell(c.header)).join(','),
      ...transfers.map((t, i) =>
        layout.columns.map((c) => csvCell(cell(c, t, i + 1, unit))).join(','),
      ),
    ];
    return [{ part: '', text: `${lines.join('\n')}\n`, rows: transfers.length }];
  }

  // Grids: one per destination plate and source well, in the order they first appear.
  const grids = new Map<string, WorklistTransfer[]>();
  for (const t of transfers) {
    const key = `${t.destination.name}\u0000${t.source.name}\u0000${t.sourceWell}`;
    grids.set(key, [...(grids.get(key) ?? []), t]);
  }
  return [...grids.values()].map((group) => {
    const first = group[0] as WorklistTransfer;
    const plate = first.destination;
    const volumes = new Map<string, Quantity>();
    for (const t of group) {
      const had = volumes.get(t.destinationWell);
      volumes.set(t.destinationWell, had ? add(had, t.volume) : t.volume);
    }
    const lines = [
      ...layout.preamble.map((c) => [c.header, cell(c, first, 1, unit)].map(csvCell).join(',')),
      ['', ...Array.from({ length: plate.columns }, (_, c) => String(c + 1))].join(','),
      ...Array.from({ length: plate.rows }, (_, r) =>
        [
          rowLabel(r),
          ...Array.from({ length: plate.columns }, (_, c) => {
            const v = volumes.get(`${rowLabel(r)}${c + 1}`);
            return v && !new LabDecimal(v.value).isZero()
              ? plain(convert(v, unit).value)
              : layout.empty;
          }),
        ].join(','),
      ),
    ];
    return {
      part: `${plate.name} ${first.source.name} ${first.sourceWell}`,
      text: `${lines.join('\n')}\n`,
      rows: group.length,
    };
  });
}

const WELLS: readonly WorklistValue[] = ['source_well', 'destination_well'];

/** What makes a format unwritable, in words: checked on every write of a format record. */
export function formatProblems(a: Pick<WorklistFormatAttributes, 'layout' | 'tips'>): string[] {
  const problems: string[] = [];
  const columns = a.layout.layout === 'rows' ? a.layout.columns : a.layout.preamble;
  const headers = columns.map((c) => c.header);
  for (const h of new Set(headers.filter((h, i) => headers.indexOf(h) !== i)))
    problems.push(`The header ${h} is given twice`);
  for (const c of columns) {
    if (c.value === 'constant' && c.text === undefined)
      problems.push(`${c.header}: a constant needs its text`);
    if (c.wells && !WELLS.includes(c.value))
      problems.push(`${c.header}: well naming is for well columns only`);
    if ((c.yes !== undefined || c.no !== undefined) && c.value !== 'new_tip')
      problems.push(`${c.header}: yes and no are for the new tip column only`);
  }
  if (a.layout.layout === 'rows') {
    const has = (v: WorklistValue) => columns.some((c) => c.value === v);
    if (!has('volume')) problems.push('A rows format needs a volume column');
    if (!has('destination_well')) problems.push('A rows format needs a destination well column');
    if (a.tips === 'column' && !has('new_tip'))
      problems.push('The method takes tips as the file says, but the file has no new tip column');
    if (a.tips !== 'column' && has('new_tip'))
      problems.push(
        'The file has a new tip column, so the method takes tips as the file says (tips: column)',
      );
  } else {
    for (const c of columns)
      if (WELLS.includes(c.value) || c.value === 'row_number' || c.value === 'new_tip')
        problems.push(`${c.header}: a grid's preamble holds one value per grid, not per well`);
    if (a.tips === 'column') problems.push('A grid has no new tip column');
  }
  return problems;
}
