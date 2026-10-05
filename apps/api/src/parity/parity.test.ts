import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/testing.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';

/**
 * Writes an agent can make that have no screen of their own, each with the reason (plan 004e R11,
 * ADR 0057). Everything else an agent can change, a person can change from the web app too.
 */
const draftedByAsking =
  'Not yet a form of its own: a person asks the assistant to draft it, then edits and confirms the draft on its page';
const transferScreens =
  'Transfer plan and worklist format screens come after the UI fixes land (016 screens)';
const notYet = (where: string) => `No screen yet; ${where}`;

const noScreen: Record<string, string> = {
  'assistant.send': 'The assistant panel itself; agents do not call it',
  'changes.apply':
    'Bundles other operations so an agent asks once; a person makes the same changes one by one, on the screens of the steps that have one',
  'library.propose_mentions': notYet(
    'a person confirms or rejects the mentions an agent proposed in Review, but cannot add one',
  ),
  'assays.save_from_experiment': notYet(
    "saving an experiment as a template comes with the experiment's design page (017b)",
  ),
  'assays.draft_template': notYet(
    'assay template screens come with the experiment designer (017b)',
  ),
  'campaigns.draft': draftedByAsking,
  'experiments.draft': draftedByAsking,
  'sops.draft': draftedByAsking,
  'sops.ask_question':
    'A person asks the assistant to add a scientific question, then records their response on the SOP page; direct question-authoring controls belong to 004g SG-05',
  'platemaps.draft': draftedByAsking,
  'layouts.draft': draftedByAsking,
  'workcells.draft': draftedByAsking,
  'entities.draft': draftedByAsking,
  'entities.draft_kind': draftedByAsking,
  'reagents.draft_product': draftedByAsking,
  'sets.create': draftedByAsking,
  'transfers.draft': transferScreens,
  'transfers.draft_from_plate_map': transferScreens,
  'transfers.export': transferScreens,
  'transfers.import_report': transferScreens,
  'transfers.pick_sources': transferScreens,
  'transfers.set_instrument': transferScreens,
  'transfers.set_deck': transferScreens,
  'worklists.draft_format': transferScreens,
  'memory.propose':
    'Agents propose lab memory; a person states it with memory.remember and confirms a proposal on its Remember card, the Lab memory page or Review',
  'memory.observe':
    'Detectors and agents reading results report observations; a person states a memory with memory.remember instead',
  'campaigns.set_stage': notYet('the campaign and experiment pages show the stage only'),
  'experiments.bind_protocol': notYet('the experiment page shows the protocol only'),
  'instruments.change_configuration': notYet('the instrument page shows it read-only'),
  'instruments.log_service': notYet('the instrument page lists service read-only'),
  'instruments.register': notYet('the instruments page lists them read-only'),
  'instruments.set_status': notYet('the instrument page shows the status only'),
  'workcells.change_members': notYet('the workcell page (008d-3) is next in plan 008d'),
  'inventory.correct': notYet('the container page shows contents read-only'),
  'inventory.fill': notYet('the container page shows contents read-only'),
  'inventory.register_containers': notYet('the inventory page lists them read-only'),
  'inventory.stamp': notYet('the container page shows contents read-only'),
  'inventory.transfer': notYet('the container page shows contents read-only'),
  'samples.register': notYet('the inventory page lists them read-only'),
  'locations.create': notYet('the inventory page lists them read-only'),
  'library.add_revision': notYet('the document page lists revisions read-only'),
  'liquids.record_verification': notYet('the liquid class page shows verifications read-only'),
  'reagents.receive_lot': notYet('the lots page lists them read-only'),
  'reagents.set_lot_status': notYet('the lot page shows the status only'),
  'runs.attach_data': notYet('the run page lists attached data read-only'),
  'runs.correct': notYet('the run page shows the log read-only'),
};

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@ailab\/schema';?/g;

/**
 * The contracts a source file calls: the names it imports from `@ailab/schema` as values (not
 * `type` imports) and then uses in its code, outside comments and the import itself. A name in a
 * comment, a string or an unused import doesn't count.
 */
function contractsCalled(source: string): Set<string> {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const imported: [exported: string, local: string][] = [];
  for (const [, typeOnly, specifiers = ''] of code.matchAll(IMPORT)) {
    if (typeOnly) continue;
    for (const spec of specifiers.split(',')) {
      const words = spec.trim().split(/\s+/);
      if (!words[0] || words[0] === 'type') continue;
      imported.push([words[0], words.at(-1) as string]);
    }
  }
  const body = code.replace(IMPORT, '').replace(/'[^'\n]*'|"[^"\n]*"/g, "''");
  return new Set(
    imported.filter(([, local]) => new RegExp(`\\b${local}\\b`).test(body)).map(([name]) => name),
  );
}

const webCalls = (() => {
  const root = join(import.meta.dirname, '../../../web/src');
  const called = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
        for (const c of contractsCalled(readFileSync(path, 'utf8'))) called.add(c);
    }
  };
  walk(root);
  return called;
})();

describe('what counts as a web caller', () => {
  it('is a contract imported and used, not a comment, a string or an unused import', () => {
    const source = [
      "import { recordsUpdate, type RecordEnvelope, recordsArchive as archive } from '@ailab/schema';",
      "import type { recordsDelete } from '@ailab/schema';",
      "import { recordsCreate, recordsRestore } from '@ailab/schema';",
      'api.run(recordsUpdate, input);',
      'const go = () => api.run(archive, input);',
      '// recordsCreate, someday',
      "const label = 'recordsRestore';",
      'let x: RecordEnvelope;',
    ].join('\n');
    expect([...contractsCalled(source)]).toEqual(['recordsUpdate', 'recordsArchive']);
  });
});

describe('people parity (ADR 0057)', () => {
  it('every write an agent can make has a web caller or a stated reason', async () => {
    const { db, close } = await createTestDb();
    try {
      const registry = createRegistry(db, new KindRegistry(), new ActivityBus());
      // The exported name of each contract, which a web caller imports.
      const names = new Map(
        Object.entries(schema).flatMap(([name, value]) =>
          value && typeof value === 'object' && 'id' in value && 'effect' in value
            ? [[(value as { id: string }).id, name] as const]
            : [],
        ),
      );
      const missing = registry
        .list()
        .filter((c) => c.effect === 'write' && registry.get(c.id).actors !== 'people')
        .filter((c) => !(c.id in noScreen))
        .filter((c) => {
          const name = names.get(c.id);
          return !name || !webCalls.has(name);
        })
        .map((c) => c.id);
      expect(
        missing,
        'agent writes with no web caller; add a screen or a reason to noScreen',
      ).toEqual([]);
      const stale = Object.keys(noScreen).filter(
        (id) => names.get(id) && webCalls.has(names.get(id) as string),
      );
      expect(stale, 'these have a web caller now; take them out of noScreen').toEqual([]);
    } finally {
      await close();
    }
  });
});
