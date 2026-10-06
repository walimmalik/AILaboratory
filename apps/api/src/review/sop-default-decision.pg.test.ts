import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connect } from '../db/client.ts';
import { RecordService } from '../records/service.ts';
import { prepareSopDefaultDecision, revalidateSopDefaultDecision } from './sop-default-decision.ts';
import { defaultDecisionFixture } from './test-sop-default.ts';

const url = process.env.TEST_DATABASE_URL;
const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Requires disposable Postgres: PGlite cannot demonstrate a second connection waiting on a row lock. */
describe.skipIf(!url)('SOP default preview locks on Postgres', () => {
  it('holds an actually read indirect dependency through caller commit, then refreshes its changed check facts', async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const name = `ailab_sop_decision_${Date.now()}`;
    await admin.query(`create database ${name}`);
    const scratch = new URL(url as string);
    scratch.pathname = `/${name}`;
    const primary = await connect(scratch.toString());
    scratch.searchParams.set('application_name', 'sop_decision_competitor');
    const competitor = await connect(scratch.toString());
    const held = deferred();
    const release = deferred();
    let pending: Promise<unknown> | undefined;
    let mutation: Promise<unknown> | undefined;
    try {
      await primary.migrate();
      const f = await defaultDecisionFixture(primary.db);
      const proposal = await prepareSopDefaultDecision(f, f.agent, f.edit);
      pending = f.registry.transaction(primary.db, async (tx) => {
        const result = await revalidateSopDefaultDecision(
          { ...f, db: tx },
          f.person,
          proposal.id,
          proposal.decision?.previewIdentity.digest ?? '',
        );
        expect(result.status).toBe('unchanged');
        held.resolve();
        await release.promise;
      });
      // Surface setup failures instead of waiting forever for a lock signal.
      await Promise.race([
        held.promise,
        pending.then(() => {
          throw new Error('Preview transaction ended before signalling locks');
        }),
      ]);
      mutation = new RecordService(competitor.db, f.kinds).update(f.agent, f.product.id, {
        expectedVersion: f.product.version,
        attributes: { ...f.product.attributes, lotFields: [] },
      });
      const until = Date.now() + 10_000;
      let waiting = false;
      while (Date.now() < until) {
        const state = await admin.query(
          "select 1 from pg_stat_activity where datname = $1 and application_name = 'sop_decision_competitor' and wait_event_type = 'Lock'",
          [name],
        );
        if (state.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      expect((await f.service.get(f.person, f.product.id)).version).toBe(f.product.version);
      release.resolve();
      await pending;
      await mutation;
      const result = await f.registry.transaction(primary.db, (tx) =>
        revalidateSopDefaultDecision(
          { ...f, db: tx },
          f.person,
          proposal.id,
          proposal.decision?.previewIdentity.digest ?? '',
        ),
      );
      expect(result.status).toBe('refreshed');
      expect(result.proposal.status).toBe('pending');
      expect((await f.service.get(f.person, f.target.id)).version).toBe(f.target.version);
    } finally {
      release.resolve();
      await Promise.allSettled([pending, mutation].filter((p) => p !== undefined));
      await competitor.close();
      await primary.close();
      await admin.query(`drop database ${name}`);
      await admin.end();
    }
  }, 60_000);
});
