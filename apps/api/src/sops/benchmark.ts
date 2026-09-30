import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scoreSop } from '@ailab/domain';
import {
  type Actor,
  type RecordEnvelope,
  type RecordVersion,
  type SopAttributes,
  SopExpectation,
  type SopReviewRound,
  type SopScore,
} from '@ailab/schema';
import { parse } from 'yaml';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * The digitizing benchmark (plan 012 G11): every SOP digitized from a document in
 * `seed/sop-benchmark/` scored against what it must contain, before and after review, so models
 * (and the review cycle) can be compared by number. Digitizing itself is an agent's job; this scores.
 */

export async function readExpectations(folder: string): Promise<SopExpectation[]> {
  const files = (await readdir(folder)).filter((f) => /\.ya?ml$/.test(f)).sort();
  return Promise.all(
    files.map(async (f) => {
      const parsed = SopExpectation.safeParse(parse(await readFile(join(folder, f), 'utf8')));
      if (!parsed.success) throw new Error(`${f}: ${parsed.error.message}`);
      return parsed.data;
    }),
  );
}

export interface BenchmarkRow {
  key: string;
  sop: string;
  label: string;
  draftedBy: string;
  score: SopScore;
  /** The score of the draft as it was before the first review round, when it was reviewed. */
  beforeReview?: SopScore;
  reviewRounds: number;
  checked: boolean;
}

const who = (actor: Actor) => (actor.type === 'agent' ? actor.agentName : 'a person');

export async function runBenchmark(
  registry: OperationRegistry,
  ctx: RecordContext,
  expectations: SopExpectation[],
): Promise<BenchmarkRow[]> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}`);
    return result.output as T;
  };
  const sops = (
    await run<{ records: RecordEnvelope[] }>('records.list', { kind: 'sop', limit: 200 })
  ).records;
  const rows: BenchmarkRow[] = [];
  for (const e of expectations) {
    const documents = (
      await run<{ records: RecordEnvelope[] }>('records.list', {
        kind: 'document',
        search: e.document,
        limit: 50,
      })
    ).records.filter((d) => d.label === e.document);
    const ids = new Set(documents.map((d) => d.id));
    for (const sop of sops.filter((s) => {
      const source = (s.attributes as SopAttributes).source?.document;
      return source !== undefined && ids.has(source);
    })) {
      const { versions } = await run<{ versions: RecordVersion[] }>('records.history', {
        id: sop.id,
      });
      const { rounds } = await run<{ rounds: SopReviewRound[] }>('sops.reviews', { sop: sop.id });
      const first = versions.find((v) => v.version === 1);
      const before = rounds[0]
        ? versions.find((v) => v.version === rounds[0]?.fromVersion)
        : undefined;
      rows.push({
        key: e.key,
        sop: sop.name,
        label: sop.label,
        draftedBy: first ? who(first.actor) : who(sop.updatedBy),
        score: await run<SopScore>('sops.score', { sop: sop.id, expected: e }),
        ...(before
          ? { beforeReview: scoreSop(before.snapshot.attributes as SopAttributes, e) }
          : {}),
        reviewRounds: rounds.length,
        checked: e.checked,
      });
    }
  }
  return rows;
}

const pct = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n * 100)}%`);

/** The rows as a Markdown table, for a PR description. */
export function benchmarkTable(rows: BenchmarkRow[]): string {
  const lines = [
    '| Source | SOP | Drafted by | Review rounds | Overall | Before review | Materials | Steps | Step order | Values | Questions |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      [
        `${r.key}${r.checked ? '' : ' (unchecked)'}`,
        `${r.sop} ${r.label}`,
        r.draftedBy,
        r.reviewRounds,
        pct(r.score.overall),
        pct(r.beforeReview?.overall),
        pct(r.score.materials?.recall),
        pct(r.score.steps?.recall),
        pct(r.score.steps?.order),
        pct(r.score.values?.recall),
        pct(r.score.questions?.recall),
      ].join(' | '),
    ),
  ];
  return lines.map((l) => (l.startsWith('|') ? l : `| ${l} |`)).join('\n');
}
