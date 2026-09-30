import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { contextFor } from './auth.ts';
import { connect } from './db/client.ts';
import { users } from './db/schema.ts';
import { entityKinds } from './entities/kinds.ts';
import { fileKinds } from './files/kinds.ts';
import { fileStoreFromEnv } from './files/store.ts';
import { instrumentKinds } from './instruments/kinds.ts';
import { labwareKinds } from './labware/kinds.ts';
import { converterFromEnv } from './library/convert.ts';
import { libraryKinds } from './library/kinds.ts';
import { ActivityBus, createRegistry } from './operations/index.ts';
import { reagentKinds } from './reagents/kinds.ts';
import { KindRegistry } from './records/kinds.ts';
import { benchmarkTable, readExpectations, runBenchmark } from './sops/benchmark.ts';
import { sopKinds } from './sops/kinds.ts';

/**
 * Scores every SOP digitized from a benchmark document (plan 012 G11) and prints a Markdown table.
 * Digitize first by asking an agent (the sops skill), then run:
 *
 *   pnpm --filter @ailab/api sop:benchmark
 *   pnpm --filter @ailab/api sop:benchmark --out benchmark.md
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    folder: { type: 'string', default: '../../seed/sop-benchmark' },
    out: { type: 'string' },
    user: { type: 'string' },
  },
});

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const connection = await connect(url);
await connection.migrate();
const all = await connection.db
  .select({ id: users.id, name: users.displayName, orgId: users.orgId })
  .from(users);
const user = values.user
  ? all.find((u) => u.id === values.user)
  : all.length === 1
    ? all[0]
    : undefined;
const ctx = user
  ? await contextFor(
      connection.db,
      { type: 'agent', agentName: 'SOP benchmark', onBehalfOf: user.id },
      user.orgId,
    )
  : undefined;
if (!ctx) {
  console.error(
    all.length === 0
      ? 'No users yet. Run the bootstrap command first.'
      : `Pass --user with one of: ${all.map((u) => `${u.id} (${u.name})`).join(', ')}`,
  );
  await connection.close();
  process.exit(1);
}
const kinds = new KindRegistry();
for (const kind of [
  ...labwareKinds,
  ...instrumentKinds,
  ...reagentKinds,
  ...entityKinds,
  ...fileKinds,
  ...libraryKinds,
  ...sopKinds,
])
  kinds.register(kind);
const registry = createRegistry(connection.db, kinds, new ActivityBus(), undefined, {
  files: fileStoreFromEnv(process.env),
  converter: converterFromEnv(process.env),
});

const expectations = await readExpectations(resolve(values.folder as string));
const rows = await runBenchmark(registry, ctx, expectations);
const table = rows.length
  ? benchmarkTable(rows)
  : `No SOPs digitized from the ${expectations.length} benchmark documents yet. Ask an agent to digitize one (the sops skill), then run this again.`;
console.log(table);
for (const r of rows) {
  const missing = [
    ...(r.score.steps?.missing ?? []).map((m: string) => `step ${m}`),
    ...(r.score.values?.missing ?? []),
    ...(r.score.materials?.missing ?? []),
    ...(r.score.questions?.missing ?? []).map((m: string) => `question: ${m}`),
  ];
  if (missing.length) console.log(`\n${r.sop} misses: ${missing.join('; ')}`);
}
if (values.out) await writeFile(values.out, `${table}\n`);
await connection.close();
