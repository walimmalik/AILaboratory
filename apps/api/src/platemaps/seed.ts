import type { RecordEnvelope } from '@ailab/schema';
import { parse } from 'yaml';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/** The demo lab's layout templates (plan 014a) from `seed/layouts.yaml`. */

interface SeedLayoutFile {
  layouts: ({ key: string; template?: string; label: string } & Record<string, unknown>)[];
}

export interface SeedLayout {
  key: string;
  label: string;
  attributes: Record<string, unknown>;
}

export function readSeedLayouts(text: string): SeedLayout[] {
  return (parse(text) as SeedLayoutFile).layouts.map(
    ({ key, template: _t, label, ...attributes }) => ({
      key,
      label,
      attributes,
    }),
  );
}

export async function loadSeedLayouts(
  registry: OperationRegistry,
  ctx: RecordContext,
  layouts: SeedLayout[],
  reason: string,
): Promise<{ created: string[]; existing: string[] }> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const report = { created: [] as string[], existing: [] as string[] };
  for (const layout of layouts) {
    const found = (
      await run<{ records: RecordEnvelope[] }>('records.list', {
        kind: 'layout',
        search: layout.label,
        limit: 50,
      })
    ).records.find((r) => r.label === layout.label && r.status !== 'archived');
    if (found) {
      report.existing.push(layout.label);
      continue;
    }
    const evidence = Object.fromEntries(
      Object.keys(layout.attributes).map((name) => [
        name,
        { source: 'stated', note: 'Lab convention in seed/assays.yaml' },
      ]),
    );
    const record = await run<RecordEnvelope>('layouts.draft', {
      label: layout.label,
      ...layout.attributes,
      evidence,
      reason,
    });
    report.created.push(`${record.name} ${layout.label}`);
  }
  return report;
}
