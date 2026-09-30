import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { contextFor } from './auth.ts';
import { campaignKinds } from './campaigns/kinds.ts';
import { loadSeedCampaigns, readSeedCampaigns } from './campaigns/seed.ts';
import { connect } from './db/client.ts';
import { users } from './db/schema.ts';
import { entityKinds } from './entities/kinds.ts';
import { loadSeedEntities, readSeedEntities } from './entities/seed.ts';
import { fileKinds } from './files/kinds.ts';
import { fileStoreFromEnv } from './files/store.ts';
import { instrumentKinds } from './instruments/kinds.ts';
import { loadSeedInstruments, readSeedInstruments } from './instruments/seed.ts';
import { loadSeedContents, readSeedContents } from './inventory/contents-seed.ts';
import { inventoryKinds } from './inventory/kinds.ts';
import { loadSeedInventory, readSeedInventory } from './inventory/seed.ts';
import { labwareKinds } from './labware/kinds.ts';
import { loadSeedLabware, readDefinitions } from './labware/seed.ts';
import { converterFromEnv } from './library/convert.ts';
import { importIntoLibrary, readManifestFolder, readMarkdownFolder } from './library/import.ts';
import { libraryKinds } from './library/kinds.ts';
import { ActivityBus, createRegistry } from './operations/index.ts';
import { plateMapKinds } from './platemaps/kinds.ts';
import { loadSeedLayouts, readSeedLayouts } from './platemaps/seed.ts';
import { reagentKinds } from './reagents/kinds.ts';
import { loadSeedLiquidClasses, readSeedLiquidClasses } from './reagents/liquid-seed.ts';
import { loadSeedReagents, readSeedReagents } from './reagents/seed.ts';
import { KindRegistry } from './records/kinds.ts';
import type { RecordContext } from './records/service.ts';
import { type SettleReport, settleSeed } from './seed-settle.ts';
import { sopKinds } from './sops/kinds.ts';
import { loadSeedSops, readSeedSops } from './sops/seed.ts';
import { transferKinds } from './transfers/kinds.ts';

/**
 * Loads the seed lab (seed/, plan 006) in one run, with no approvals (ADR 0044): labware types,
 * instrument and equipment kinds and instruments, reagents and lots, liquid classes, entity kinds
 * and entities, library documents (seed/sops/own and docs/sop-library), the lab's own SOPs as
 * digital SOPs, locations, containers, samples, what the containers hold, and the demo campaigns.
 * The agent "Seed loader" writes everything on behalf of a user, so every value shows where it came
 * from; the run then confirms it as that user, since running the seed is their decision to take the
 * seed lab as it is. Only records the seed can't settle (a failing blocker) are left on Review.
 * Safe to run again: records the lab already has are left alone, except that labware types it made
 * get well positions the seed has gained since, while nobody else has changed their wells.
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

const loader: RecordContext = ctx;

const kinds = new KindRegistry();
for (const kind of [
  ...labwareKinds,
  ...instrumentKinds,
  ...reagentKinds,
  ...entityKinds,
  ...inventoryKinds,
  ...fileKinds,
  ...libraryKinds,
  ...sopKinds,
  ...campaignKinds,
  ...plateMapKinds,
  ...transferKinds,
])
  kinds.register(kind);
const registry = createRegistry(connection.db, kinds, new ActivityBus(), undefined, {
  files: fileStoreFromEnv(process.env),
  converter: converterFromEnv(process.env),
});

/** One loading pass over seed/, in dependency order. Each pass adds what the last one unblocked. */
async function loadOnce() {
  const ctx = loader;
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
  await settle();
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

  await settle();
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

  await settle();
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

  await settle();
  const entities = await loadSeedEntities(
    registry,
    ctx,
    readSeedEntities(await seedFile('entity-library.yaml'), await seedFile('reagent-library.yaml')),
  );
  console.log(
    `Entity kinds: ${entities.kinds.created.length} drafted, ${entities.kinds.existing.length} already there.`,
  );
  console.log(
    `Entities: ${entities.entities.created.length} drafted, ${entities.entities.existing.length} already there.`,
  );
  for (const line of entities.entities.created) console.log(`  + ${line}`);
  await settle();
  const inventory = await loadSeedInventory(
    registry,
    ctx,
    readSeedInventory({
      lab: await seedFile('lab.yaml'),
      inventory: await seedFile('inventory.yaml'),
      labware: await seedFile('labware.yaml'),
    }),
  );
  for (const [what, part] of [
    ['Locations', inventory.locations],
    ['Containers', inventory.containers],
  ] as const) {
    console.log(
      `${what}: ${part.created.length} added, ${part.proposed.length} proposed for review, ${part.existing.length} already there or waiting, ${part.waiting.length} wait for their place to be approved (run the seed again after approving).`,
    );
    for (const line of part.created) console.log(`  + ${line}`);
  }
  for (const skip of inventory.skipped) console.log(`  skipped ${skip.key}: ${skip.reason}`);

  await settle();
  const contents = await loadSeedContents(
    registry,
    ctx,
    readSeedContents({
      inventory: await seedFile('inventory.yaml'),
      reagentLibrary: await seedFile('reagent-library.yaml'),
      entityLibrary: await seedFile('entity-library.yaml'),
    }),
  );
  for (const [what, part] of [
    ['Samples', contents.samples],
    ['Contents', contents.contents],
  ] as const) {
    console.log(
      `${what}: ${part.created.length} added, ${part.proposed.length} proposed for review, ${part.existing.length} already there or waiting, ${part.waiting.length} wait for something to be approved first (run the seed again after approving).`,
    );
    for (const line of part.waiting) console.log(`  … ${line}`);
  }
  await settle();
  const library = {
    added: [] as string[],
    existing: [] as string[],
    missing: [] as { key: string; reason: string }[],
    parsed: [] as string[],
    unparsed: [] as { key: string; reason: string }[],
    mentions: 0,
  };
  for (const plan of [
    await readMarkdownFolder(fileURLToPath(new URL('../../../seed/sops/own/', import.meta.url)), {
      name: "The lab's own",
      sharePolicy: 'shareable',
    }),
    await readManifestFolder(fileURLToPath(new URL('../../../docs/sop-library/', import.meta.url))),
  ]) {
    const part = await importIntoLibrary(
      registry,
      ctx,
      plan,
      'Seed lab (plan 006), loaded by plan 011a',
    );
    library.added.push(...part.added);
    library.existing.push(...part.existing);
    library.missing.push(...part.missing);
    library.parsed.push(...part.parsed);
    library.unparsed.push(...part.unparsed);
    library.mentions += part.mentions;
  }
  console.log(
    `Library: ${library.added.length} documents drafted, ${library.existing.length} already there, ${library.missing.length} without their files here (import them from their folder with library:import).`,
  );
  for (const line of library.added) console.log(`  + ${line}`);
  for (const skip of library.missing) console.log(`  missing ${skip.key}: ${skip.reason}`);
  console.log(
    `Library text: ${library.parsed.length} documents parsed for search, ${library.unparsed.length} not readable yet, ${library.mentions} mentions of registry records proposed for review.`,
  );
  for (const skip of library.unparsed) console.log(`  not parsed ${skip.key}: ${skip.reason}`);
  await settle();
  const sopFolder = new URL('../../../seed/sops/own/', import.meta.url);
  const sopFiles = await Promise.all(
    (await readdir(sopFolder))
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map(async (name) => ({ name, text: await readFile(new URL(name, sopFolder), 'utf8') })),
  );
  const seedSops = readSeedSops(sopFiles, {
    labware: await seedFile('labware.yaml'),
    reagentLibrary: await seedFile('reagent-library.yaml'),
    entityLibrary: await seedFile('entity-library.yaml'),
    instrumentLibrary: await seedFile('instrument-library.yaml'),
  });
  const sops = await loadSeedSops(
    registry,
    ctx,
    seedSops,
    'Seed lab (plan 006), loaded by plan 012a',
  );
  console.log(
    `Digital SOPs: ${sops.created.length} drafted, ${sops.existing.length} already there, ${sops.unbound.length} materials without their record in the lab yet (bind them when the record is there).`,
  );
  for (const line of sops.created) console.log(`  + ${line}`);
  await settle();
  const campaigns = await loadSeedCampaigns(
    registry,
    ctx,
    readSeedCampaigns(
      {
        campaigns: await seedFile('campaigns.yaml'),
        assays: await seedFile('assays.yaml'),
        entityLibrary: await seedFile('entity-library.yaml'),
      },
      new Map(seedSops.map((s) => [s.key, s.label])),
    ),
    'Seed lab (plan 006), loaded by plan 013a',
  );
  console.log(
    `Campaigns and experiments: ${campaigns.created.length} drafted, ${campaigns.existing.length} campaigns already there, ${campaigns.missing.length} SOPs or entities left out because the lab doesn't have them yet.`,
  );
  for (const line of campaigns.created) console.log(`  + ${line}`);
  for (const line of campaigns.missing) console.log(`  missing ${line}`);
  const layouts = await loadSeedLayouts(
    registry,
    ctx,
    readSeedLayouts(await seedFile('layouts.yaml')),
    'Seed lab (plan 006), loaded by plan 014a',
  );
  console.log(
    `Layout templates: ${layouts.created.length} drafted, ${layouts.existing.length} already there.`,
  );
  for (const line of layouts.created) console.log(`  + ${line}`);
  await settle();
}

const person = await contextFor(connection.db, { type: 'user', userId: user.id }, user.orgId);
if (!person) {
  console.error('That user has no lab');
  await connection.close();
  process.exit(1);
}
const reason = 'Imported from seed (pnpm seed)';
// Each pass loads what the seed has, then settles it: the loader's proposals are approved and its
// drafts confirmed as the person running the seed (ADR 0044). Rooms settle in one pass, the
// freezers in them the next, then containers, then contents, until a pass changes nothing.
const totals = { approved: 0, activated: 0 };
let left: SettleReport['left'] = [];
/** Settles what the loaders just wrote, so the next loader finds it confirmed. */
async function settle() {
  const settled = await settleSeed(
    registry,
    connection.db,
    person as RecordContext,
    loader,
    reason,
  );
  totals.approved += settled.approved.length;
  totals.activated += settled.activated.length;
  left = settled.left;
  for (const f of settled.failed) console.log(`  ! ${f.id}: ${f.reason}`);
}

for (let pass = 1; pass <= 8; pass++) {
  const before = { ...totals };
  console.log(`\nPass ${pass}`);
  await loadOnce();
  console.log(
    `Settled in this pass: ${totals.approved - before.approved} proposals approved, ${totals.activated - before.activated} records confirmed.`,
  );
  if (totals.approved === before.approved && totals.activated === before.activated) break;
}
console.log(
  left.length === 0
    ? '\nThe seed lab is loaded; nothing waits for review.'
    : `\nThe seed lab is loaded. ${left.length} records wait on the Review page because the seed can't settle them:`,
);
for (const l of left) console.log(`  ? ${l.name}: ${l.reason}`);
await connection.close();
