import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { contextFor } from './auth.ts';
import { connect } from './db/client.ts';
import { users } from './db/schema.ts';
import { fileKinds } from './files/kinds.ts';
import { fileStoreFromEnv } from './files/store.ts';
import { labwareKinds } from './labware/kinds.ts';
import { converterFromEnv } from './library/convert.ts';
import { importIntoLibrary, readManifestFolder, readMarkdownFolder } from './library/import.ts';
import { libraryKinds } from './library/kinds.ts';
import { ActivityBus, createRegistry } from './operations/index.ts';
import { KindRegistry } from './records/kinds.ts';

/**
 * Imports a folder into the library as draft documents (plan 011a): a folder with a manifest.json
 * like docs/sop-library, or a folder of Markdown SOPs with front matter. Lab-private manuals (the
 * Promega set) come in this way from the laptop folder; they never go into the repo.
 *
 *   pnpm --filter @ailab/api library:import --folder C:\dev\sop-library
 *   pnpm --filter @ailab/api library:import --folder ./my-sops --license "The lab's own"
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    folder: { type: 'string' },
    user: { type: 'string' },
    license: { type: 'string' },
  },
});

if (!values.folder) {
  console.error('Pass --folder with the folder to import');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const folder = resolve(values.folder);
const hasManifest = await access(join(folder, 'manifest.json')).then(
  () => true,
  () => false,
);
if (!hasManifest && !values.license) {
  console.error('No manifest.json there: pass --license with the license of these Markdown SOPs');
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
      { type: 'agent', agentName: 'Library import', onBehalfOf: user.id },
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
for (const kind of [...labwareKinds, ...fileKinds, ...libraryKinds]) kinds.register(kind);
const registry = createRegistry(connection.db, kinds, new ActivityBus(), undefined, {
  files: fileStoreFromEnv(process.env),
  converter: converterFromEnv(process.env),
});
const license = values.license ?? '';
const plan = hasManifest
  ? await readManifestFolder(folder)
  : await readMarkdownFolder(folder, {
      name: license,
      sharePolicy: /own|cc|mit|apache|public/i.test(license) ? 'shareable' : 'lab_private',
    });
const report = await importIntoLibrary(registry, ctx, plan, `Imported from ${folder}`);
console.log(
  `Library: ${report.added.length} documents drafted, ${report.existing.length} already there, ${report.missing.length} without their files.`,
);
for (const line of report.added) console.log(`  + ${line}`);
for (const skip of report.missing) console.log(`  missing ${skip.key}: ${skip.reason}`);
console.log(
  `Text: ${report.parsed.length} parsed for search, ${report.unparsed.length} not readable yet.`,
);
for (const skip of report.unparsed) console.log(`  not parsed ${skip.key}: ${skip.reason}`);
console.log('Drafts wait on the Review page for you to confirm.');
await connection.close();
