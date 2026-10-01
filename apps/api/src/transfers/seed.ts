import type { RecordEnvelope } from '@ailab/schema';
import { parse } from 'yaml';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/** The demo lab's worklist formats (plan 016c) from `seed/worklist-formats.yaml`. */

export interface SeedWorklistFormat {
  key: string;
  label: string;
  /** The instrument kind's label in the instrument library. */
  instrumentKind: string;
  /** The example file's name in `seed/worklists/`. */
  example: string;
  attributes: Record<string, unknown>;
}

interface SeedFile {
  formats: ({ key: string; label: string; instrument: string; example: string } & Record<
    string,
    unknown
  >)[];
}

/** The formats, with each instrument library key read as its kind's label. */
export function readSeedWorklistFormats(
  text: string,
  instrumentLibrary: string,
): SeedWorklistFormat[] {
  const labels = new Map(
    (
      parse(instrumentLibrary) as { instrument_kinds: { key: string; label: string }[] }
    ).instrument_kinds.map((k) => [k.key, k.label]),
  );
  return (parse(text) as SeedFile).formats.map(({ key, label, instrument, example, ...rest }) => {
    const instrumentKind = labels.get(instrument);
    if (!instrumentKind) throw new Error(`${key}: no instrument kind ${instrument} in the library`);
    return { key, label, instrumentKind, example, attributes: rest };
  });
}

export async function loadSeedWorklistFormats(
  registry: OperationRegistry,
  ctx: RecordContext,
  formats: SeedWorklistFormat[],
  examples: (name: string) => Promise<string>,
  reason: string,
): Promise<{ created: string[]; existing: string[]; waiting: string[] }> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const list = (kind: string) =>
    run<{ records: RecordEnvelope[] }>('records.list', { kind, limit: 200 }).then((r) => r.records);
  const kinds = new Map((await list('instrument_kind')).map((k) => [k.label, k.id]));
  const had = new Set(
    (await list('worklist_format')).filter((f) => f.status !== 'archived').map((f) => f.label),
  );
  const report = { created: [] as string[], existing: [] as string[], waiting: [] as string[] };
  for (const format of formats) {
    if (had.has(format.label)) {
      report.existing.push(format.label);
      continue;
    }
    const instrumentKind = kinds.get(format.instrumentKind);
    if (!instrumentKind) {
      report.waiting.push(`${format.label}: waits for ${format.instrumentKind}`);
      continue;
    }
    const { file } = await run<{ file: RecordEnvelope }>('files.upload', {
      name: format.example,
      mediaType: 'text/csv',
      text: await examples(format.example),
      reason: `Mock example of the ${format.label} worklist (seed/worklists)`,
    });
    const assumed = {
      source: 'assumed',
      note: 'Mock format made up on 2026-09-29 (seed/worklists/README.md); replace it with the lab method file',
    };
    const record = await run<RecordEnvelope>('worklists.draft_format', {
      label: format.label,
      instrumentKind,
      example: file.id,
      ...format.attributes,
      evidence: { method: assumed, layout: assumed, volumeUnit: assumed, tips: assumed },
      reason,
    });
    report.created.push(`${record.name} ${format.label}`);
  }
  return report;
}
