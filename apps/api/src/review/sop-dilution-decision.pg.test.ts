import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connect } from '../db/client.ts';
import { RecordService } from '../records/service.ts';
import {
  executeSopDilutionDecision,
  prepareSopDilutionDecision,
  revalidateSopDilutionDecision,
} from './sop-dilution-decision.ts';
import { dilutionDecisionFixture } from './test-sop-dilution.ts';

const url = process.env.TEST_DATABASE_URL;
const signal = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
/** PGlite establishes behavior; this optional disposable database proves competing source-row locks. */
describe.skipIf(!url)('dilution decision exact-source locks on Postgres', () => {
  it('holds actual source file/document reads through the owning write and caller commit', async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const name = `ailab_dilution_decision_${Date.now()}`;
    await admin.query(`create database ${name}`);
    const scratch = new URL(url as string);
    scratch.pathname = `/${name}`;
    const primary = await connect(scratch.toString());
    scratch.searchParams.set('application_name', 'dilution_source_competitor');
    const competitor = await connect(scratch.toString());
    const held = signal(),
      release = signal();
    let applying: Promise<unknown> | undefined, mutation: Promise<unknown> | undefined;
    try {
      await primary.migrate();
      const f = await dilutionDecisionFixture(primary.db),
        proposal = await prepareSopDilutionDecision(f, f.agent, f.input);
      applying = f.registry.transaction(primary.db, async (tx) => {
        const checked = await revalidateSopDilutionDecision(
          { ...f, db: tx },
          f.person,
          proposal.id,
          proposal.decision?.previewIdentity.digest ?? '',
        );
        if (checked.status !== 'unchanged') throw new Error('Expected unchanged');
        expect(checked.prepared.decision.reads.map((r) => r.id)).toEqual(
          expect.arrayContaining([f.file.id, f.document.id]),
        );
        const out = await executeSopDilutionDecision({ ...f, db: tx }, checked.authorization);
        expect(out.attributes.questions).toMatchObject([
          { disposition: { status: 'resolved', acceptedBy: f.person.actor } },
        ]);
        held.resolve();
        await release.promise;
      });
      await Promise.race([
        held.promise,
        applying.then(() => {
          throw new Error('Transaction completed before source lock signal');
        }),
      ]);
      mutation = new RecordService(competitor.db, f.kinds).update(f.person, f.file.id, {
        expectedVersion: f.file.version,
        label: 'Source file label after apply',
      });
      let waiting = false;
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        const state = await admin.query(
          "select 1 from pg_stat_activity where datname=$1 and application_name='dilution_source_competitor' and wait_event_type='Lock'",
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
      expect((await f.service.get(f.person, f.target.id)).version).toBe(f.target.version + 1);
      expect(
        (await f.service.history(f.person, f.target.id)).filter(
          (v) =>
            v.snapshot.attributes.questions &&
            (v.snapshot.attributes.questions as { disposition: { status: string } }[])[0]
              ?.disposition.status === 'resolved',
        ),
      ).toHaveLength(1);
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
