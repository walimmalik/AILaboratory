import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { contextFor } from './auth.ts';
import { connect } from './db/client.ts';
import { users } from './db/schema.ts';
import { entityKinds } from './entities/kinds.ts';
import { instrumentKinds } from './instruments/kinds.ts';
import { loadSeedInstruments, readSeedInstruments } from './instruments/seed.ts';
import { labwareKinds } from './labware/kinds.ts';
import { loadSeedLabware, readDefinitions } from './labware/seed.ts';
import { ActivityBus, createRegistry } from './operations/index.ts';
import { reagentKinds } from './reagents/kinds.ts';
import { loadSeedLiquidClasses, readSeedLiquidClasses } from './reagents/liquid-seed.ts';
import { loadSeedReagents, readSeedReagents } from './reagents/seed.ts';
import { KindRegistry } from './records/kinds.ts';

/**
 * Loads the seed lab (seed/, plan 006) into the database as drafts for a person to review: labware
 * types, instrument and equipment kinds and instruments, then reagents (lots as proposals). Runs as the agent "Seed loader" on behalf of a user,
 * so every value shows where it came from. Safe to run again: records the lab already has are left
 * alone, except that labware types it made get well positions the seed has gained since, while
 * nobody else has changed their wells (confirmed types as a proposal).
 *
 *   pnpm --filter @ailab/api seed
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { user: { type: 'string' } },
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
if (!user) {
  console.error(
    all.length === 0
      ? 'No users yet. Run the bootstrap command first.'
      : `Pass --user with one of: ${all.map((u) => `${u.id} (${u.name})`).join(', ')}`,
  );
  await connection.close();
  process.exit(1);
}

const ctx = await contextFor(
  connection.db,
  { type: 'agent', agentName: 'Seed loader', onBehalfOf: user.id },
  user.orgId,
);
if (!ctx) {
  console.error('That user has no lab');
  await connection.close();
  process.exit(1);
}

const kinds = new KindRegistry();
for (const kind of [...labwareKinds, ...instrumentKinds, ...reagentKinds, ...entityKinds])
  kinds.register(kind);
const registry = createRegistry(connection.db, kinds, new ActivityBus());

const yaml = await readFile(new URL('../../../seed/labware.yaml', import.meta.url), 'utf8');
const definitions = await readDefinitions(new URL('../../../seed/opentrons/', import.meta.url));
const report = await loadSeedLabware(registry, ctx, yaml, definitions);
console.log(
  `Labware types: ${report.created.length} drafted, ${report.updated.length} updated, ${report.proposed.length} proposed for review, ${report.existing.length} already there.`,
);
for (const line of report.created) console.log(`  + ${line}`);
for (const line of report.updated) console.log(`  ~ ${line} (well positions)`);
for (const line of report.proposed)
  console.log(`  ? ${line} (well positions, confirmed type: approve on Review)`);
for (const skip of report.skipped) console.log(`  skipped ${skip.key}: ${skip.reason}`);

const seedFile = (name: string) =>
  readFile(new URL(`../../../seed/${name}`, import.meta.url), 'utf8');
const instruments = await loadSeedInstruments(
  registry,
  ctx,
  readSeedInstruments(
    await seedFile('instrument-library.yaml'),
    await seedFile('instruments.yaml'),
  ),
);
console.log(
  `Instrument and equipment kinds: ${instruments.created.length} drafted, ${instruments.existing.length} already there.`,
);
for (const line of instruments.created) console.log(`  + ${line}`);
console.log(
  `Instruments: ${instruments.registered.length} registered, ${instruments.registeredBefore.length} already there.`,
);
for (const line of instruments.registered) console.log(`  + ${line}`);

const reagents = await loadSeedReagents(
  registry,
  ctx,
  readSeedReagents(await seedFile('reagent-library.yaml')),
);
console.log(
  `Liquid types: ${reagents.liquidTypes.created.length} created, ${reagents.liquidTypes.existing.length} already there.`,
);
console.log(
  `Products: ${reagents.products.created.length} drafted, ${reagents.products.existing.length} already there.`,
);
for (const line of reagents.products.created) console.log(`  + ${line}`);
console.log(
  `Lots: ${reagents.lots.proposed.length} proposed for review, ${reagents.lots.existing.length} already recorded or waiting.`,
);

const classFiles = Object.fromEntries(
  await Promise.all(
    ['water.json', 'glycerol_50.json', 'ethanol_80.json'].map(
      async (name) => [name, await seedFile(`liquid-classes/opentrons/${name}`)] as const,
    ),
  ),
);
const classes = await loadSeedLiquidClasses(
  registry,
  ctx,
  readSeedLiquidClasses({
    index: await seedFile('liquid-classes.yaml'),
    opentrons: classFiles,
    hamilton: await seedFile('liquid-classes/hamilton-defaults.yaml'),
    instrumentLibrary: await seedFile('instrument-library.yaml'),
    labware: await seedFile('labware.yaml'),
    reagentLibrary: await seedFile('reagent-library.yaml'),
  }),
);
console.log(
  `Liquid classes: ${classes.created.length} drafted, ${classes.existing.length} already there, ${classes.skipped.length} skipped (the lab lacks their instrument, device, tips or liquid type).`,
);
console.log('Drafts wait on the Review page for you to confirm.');
await connection.close();
