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
const transferScreens = 'Transfer plan screens come with 016c and 016d, after the morning review';
const notYet = (where: string) => `No screen yet; ${where}`;

const noScreen: Record<string, string> = {
  'assistant.send': 'The assistant panel itself; agents do not call it',
  'changes.apply': 'Runs other operations together; each step has its own screen',
  'library.propose_mentions': 'Agents propose mentions; people review them in Review',
  'records.create': draftedByAsking,
  'campaigns.draft': draftedByAsking,
  'experiments.draft': draftedByAsking,
  'sops.draft': draftedByAsking,
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
  'campaigns.set_stage': notYet('the campaign and experiment pages show the stage only'),
  'experiments.adopt_versions': notYet('the experiment page shows newer versions only'),
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

const webSource = (() => {
  const root = join(import.meta.dirname, '../../../web/src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk(root);
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
})();

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
          return !name || !new RegExp(`\\b${name}\\b`).test(webSource);
        })
        .map((c) => c.id);
      expect(
        missing,
        'agent writes with no web caller; add a screen or a reason to noScreen',
      ).toEqual([]);
      const stale = Object.keys(noScreen).filter(
        (id) => names.get(id) && new RegExp(`\\b${names.get(id)}\\b`).test(webSource),
      );
      expect(stale, 'these have a web caller now; take them out of noScreen').toEqual([]);
    } finally {
      await close();
    }
  });
});
