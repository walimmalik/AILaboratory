import type { RecordEnvelope } from '@ailab/schema';
import { parse } from 'yaml';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';
import { labelOf } from './operations.ts';

/**
 * The demo lab's memories (plan 005a, M18) from `seed/memory.yaml`. Records are named there as
 * `{kind: label}` (e.g. `{sop: "HEK293 routine passaging"}`) and found by label; a memory whose
 * records aren't in the lab yet waits for a later pass.
 */

export type SeedMemory = Record<string, unknown> & { statement: string };

export function readSeedMemories(text: string): SeedMemory[] {
  return (parse(text) as { memories: SeedMemory[] }).memories;
}

/** The record kinds a seed memory names by label. */
const NAMED = ['sop', 'instrument_kind', 'liquid_type', 'entity_kind', 'product'] as const;

export async function loadSeedMemories(
  registry: OperationRegistry,
  ctx: RecordContext,
  memories: SeedMemory[],
  reason: string,
): Promise<{ created: string[]; existing: string[]; waiting: string[] }> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const list = (kind: string) =>
    run<{ records: RecordEnvelope[] }>('records.list', { kind, limit: 200 }).then((r) =>
      r.records.filter((x) => x.status !== 'archived'),
    );
  const ids = new Map<string, string>();
  for (const kind of NAMED) for (const r of await list(kind)) ids.set(`${kind}|${r.label}`, r.id);
  const had = new Set((await list('memory')).map((m) => m.label));

  /** The seed value with every `{kind: label}` read as the record's id; misses are collected. */
  const resolve = (value: unknown, missing: string[]): unknown => {
    if (Array.isArray(value)) return value.map((v) => resolve(v, missing));
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value);
    const [only] = entries;
    if (entries.length === 1 && only && (NAMED as readonly string[]).includes(only[0])) {
      const id = ids.get(`${only[0]}|${String(only[1])}`);
      if (!id) missing.push(`${only[0].replace('_', ' ')} ${String(only[1])}`);
      return id;
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, resolve(v, missing)]));
  };

  const report = { created: [] as string[], existing: [] as string[], waiting: [] as string[] };
  for (const memory of memories) {
    const label = labelOf(memory.statement);
    if (had.has(label)) {
      report.existing.push(label);
      continue;
    }
    const missing: string[] = [];
    const input = resolve(memory, missing) as Record<string, unknown>;
    if (missing.length) {
      report.waiting.push(`${label}: waits for ${missing.join(', ')}`);
      continue;
    }
    const record = await run<RecordEnvelope>('memory.propose', {
      ...input,
      source: { from: 'stated', note: 'Demo Lab (fictional), seed/memory.yaml' },
      reason,
    });
    report.created.push(`${record.name} ${label}`);
  }
  return report;
}
