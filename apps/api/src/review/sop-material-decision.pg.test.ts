import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connect } from '../db/client.ts';
import { RecordService } from '../records/service.ts';
import {
  executeSopMaterialDecision,
  prepareSopMaterialDecision,
  revalidateSopMaterialDecision,
} from './sop-input-decision.ts';
import { defaultDecisionFixture } from './test-sop-default.ts';

const url = process.env.TEST_DATABASE_URL;
const signal = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
/** Optional disposable-Postgres evidence; PGlite cannot prove competing row-lock behavior. */
describe.skipIf(!url)('experiment-material decision dependency locks on Postgres', () => {
  it('holds actual indirect reads through the owning write and caller commit', async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const name = `ailab_material_decision_${Date.now()}`;
    await admin.query(`create database ${name}`);
    const scratch = new URL(url as string);
    scratch.pathname = `/${name}`;
    const primary = await connect(scratch.toString());
    scratch.searchParams.set('application_name', 'material_decision_competitor');
    const competitor = await connect(scratch.toString());
    const held = signal(),
      release = signal();
    let mutation: Promise<unknown> | undefined, applying: Promise<unknown> | undefined;
    try {
      await primary.migrate();
      const f = await defaultDecisionFixture(primary.db);
      const target = await f.draft({
        ...f.target.attributes,
        materials: [
          ...f.target.attributes.materials,
          {
            role: 'plate',
            label: 'Assay plate',
            type: 'labware',
            requirements: 'Declared plate requirement',
          },
        ],
        questions: [
          {
            id: 'plate',
            question: 'Which assay plate?',
            about: { material: 'plate' },
            stage: {
              stage: 'experiment',
              reason: 'Each experiment chooses',
              binding: { type: 'material_role', role: 'plate' },
            },
            responses: [],
            disposition: { status: 'open' },
          },
        ],
      });
      const proposal = await prepareSopMaterialDecision(f, f.agent, {
        sop: target.id,
        expectedVersion: target.version,
        question: 'plate',
        reason: 'Require explicit material choice',
      });
      applying = f.registry.transaction(primary.db, async (tx) => {
        const checked = await revalidateSopMaterialDecision(
          { ...f, db: tx },
          f.person,
          proposal.id,
          proposal.decision?.previewIdentity.digest ?? '',
        );
        if (checked.status !== 'unchanged') throw new Error('Expected unchanged');
        const out = await executeSopMaterialDecision({ ...f, db: tx }, checked.authorization);
        expect(out.attributes.questions).toMatchObject([
          { disposition: { status: 'deferred', acceptedBy: f.person.actor } },
        ]);
        held.resolve();
        await release.promise;
      });
      await Promise.race([
        held.promise,
        applying.then(() => {
          throw new Error('Transaction completed before locks signalled');
        }),
      ]);
      mutation = new RecordService(competitor.db, f.kinds).update(f.agent, f.product.id, {
        expectedVersion: f.product.version,
        attributes: { ...f.product.attributes, lotFields: [] },
      });
      let waiting = false;
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        const state = await admin.query(
          "select 1 from pg_stat_activity where datname=$1 and application_name='material_decision_competitor' and wait_event_type='Lock'",
          [name],
        );
        if (state.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      release.resolve();
      await applying;
      await mutation;
      expect((await f.service.get(f.person, target.id)).attributes.questions).toMatchObject([
        { disposition: { status: 'deferred' } },
      ]);
    } finally {
      release.resolve();
      await Promise.allSettled([applying, mutation].filter((p): p is Promise<unknown> => !!p));
      await competitor.close();
      await primary.close();
      await admin.query(`drop database ${name}`);
      await admin.end();
    }
  });
});
