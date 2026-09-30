/**
 * The Echo pick list (plan 016b, T1, T3): the columns the lab's Echo 650 reads, as Wali described
 * them (seed/worklists/README.md). The format is the vendor's, so the writer is code.
 */

export const ECHO_PICK_LIST_COLUMNS = [
  'Source Plate Name',
  'Source Plate Barcode',
  'Source Plate Type',
  'Source Well',
  'Transfer Volume',
  'Destination Plate Name',
  'Destination Plate Barcode',
  'Destination Plate Type',
  'Destination Well',
] as const;

export interface EchoPlate {
  name: string;
  barcode: string;
  type: string;
}

export interface EchoRow {
  source: EchoPlate;
  sourceWell: string;
  /** In nanolitres, as a decimal string. */
  volume: string;
  destination: EchoPlate;
  destinationWell: string;
}

export const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** The pick list as CSV, one row per transfer in the order given, ending with a newline. */
export function echoPickList(rows: readonly EchoRow[]): string {
  const lines = [
    ECHO_PICK_LIST_COLUMNS.join(','),
    ...rows.map((r) =>
      [
        r.source.name,
        r.source.barcode,
        r.source.type,
        r.sourceWell,
        r.volume,
        r.destination.name,
        r.destination.barcode,
        r.destination.type,
        r.destinationWell,
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  return `${lines.join('\n')}\n`;
}
