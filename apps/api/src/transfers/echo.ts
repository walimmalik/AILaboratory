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

/** Rows of a CSV file (RFC 4180 quoting), without blank lines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export interface EchoReportPlate {
  name: string;
  barcode: string;
}

export interface EchoTransferRow {
  source: EchoReportPlate;
  sourceWell: string;
  destination: EchoReportPlate;
  destinationWell: string;
  /** Requested and actual, in nanolitres. */
  requested: string;
  actual: string;
  status: string;
}

export interface EchoSurveyRow {
  plate: EchoReportPlate;
  well: string;
  /** In microlitres. */
  volume: string;
  status: string;
}

export type EchoReport =
  | { report: 'echo_transfer'; rows: EchoTransferRow[] }
  | { report: 'echo_survey'; rows: EchoSurveyRow[] };

export class EchoReportError extends Error {}

const NUMBER = /^\d+(\.\d+)?$/;

/**
 * An Echo transfer or survey report. The column block starts at the row naming "Source Plate
 * Name", so the run header and footer sections the instrument adds around it are skipped.
 */
export function readEchoReport(text: string): EchoReport {
  const rows = parseCsv(text);
  const at = rows.findIndex((r) => r.some((c) => c.trim() === 'Source Plate Name'));
  if (at < 0) throw new EchoReportError('This is not an Echo report: no Source Plate Name column');
  const header = (rows[at] as string[]).map((c) => c.trim());
  const body = rows.slice(at + 1).filter((r) => r.length >= header.length - 1);
  const col = (name: string, required = true) => {
    const i = header.indexOf(name);
    if (i < 0 && required) throw new EchoReportError(`The report has no ${name} column`);
    return i;
  };
  const value = (r: string[], i: number) => (i < 0 ? '' : (r[i] ?? '').trim());
  const number = (r: string[], i: number, line: number, name: string) => {
    const v = value(r, i);
    if (!NUMBER.test(v)) throw new EchoReportError(`Row ${line}: ${name} is "${v}", not a number`);
    return v;
  };
  const sName = col('Source Plate Name');
  const sCode = col('Source Plate Barcode');
  const sWell = col('Source Well');
  if (header.includes('Actual Volume')) {
    const dName = col('Destination Plate Name');
    const dCode = col('Destination Plate Barcode');
    const dWell = col('Destination Well');
    const req = col('Transfer Volume');
    const act = col('Actual Volume');
    const status = col('Transfer Status', false);
    return {
      report: 'echo_transfer',
      rows: body.map((r, i) => ({
        source: { name: value(r, sName), barcode: value(r, sCode) },
        sourceWell: value(r, sWell),
        destination: { name: value(r, dName), barcode: value(r, dCode) },
        destinationWell: value(r, dWell),
        requested: number(r, req, i + 1, 'Transfer Volume'),
        actual: number(r, act, i + 1, 'Actual Volume'),
        status: value(r, status),
      })),
    };
  }
  if (header.includes('Survey Fluid Volume')) {
    const vol = col('Survey Fluid Volume');
    const status = col('Survey Status', false);
    return {
      report: 'echo_survey',
      rows: body.map((r, i) => ({
        plate: { name: value(r, sName), barcode: value(r, sCode) },
        well: value(r, sWell),
        volume: number(r, vol, i + 1, 'Survey Fluid Volume'),
        status: value(r, status),
      })),
    };
  }
  throw new EchoReportError(
    'This Echo file is neither a transfer report (Actual Volume) nor a survey (Survey Fluid Volume)',
  );
}
