import { proposalsApprove, type RecordEnvelope } from '@ailab/schema';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connect } from '../db/client.ts';
import { RecordService } from '../records/service.ts';
import {
  executeSopInputDecision,
  prepareSopInputDecision,
  revalidateSopInputDecision,
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
describe.skipIf(!url)('experiment-input decision dependency locks on Postgres', () => {
  it.each(['private-owning-write', 'public-approval-receipt'] as const)(
    'holds actual indirect reads through %s and caller commit',
    async (mode) => {
      const admin = new pg.Client({ connectionString: url });
      await admin.connect();
      const name = `ailab_input_decision_${Date.now()}`;
      await admin.query(`create database ${name}`);
      const scratch = new URL(url as string);
      scratch.pathname = `/${name}`;
      const primary = await connect(scratch.toString());
      scratch.searchParams.set('application_name', 'input_decision_competitor');
      const competitor = await connect(scratch.toString());
      const held = signal(),
        release = signal();
      let mutation: Promise<unknown> | undefined, applying: Promise<unknown> | undefined;
      try {
        await primary.migrate();
        const f = await defaultDecisionFixture(primary.db);
        const target = await f.draft({
          ...f.target.attributes,
          variables: [
            ...f.target.attributes.variables,
            { name: 'count', label: 'Count', kind: 'input', value: '1' },
          ],
          questions: [
            {
              id: 'count',
              question: 'How many?',
              about: { variable: 'count' },
              stage: {
                stage: 'experiment',
                reason: 'Each experiment chooses',
                binding: { type: 'input', variable: 'count' },
              },
              responses: [],
              disposition: { status: 'open' },
            },
          ],
        });
        const input = {
          sop: target.id,
          expectedVersion: target.version,
          question: 'count',
          reason: 'Require explicit count',
        };
        const prepared =
          mode === 'private-owning-write'
            ? {
                status: 'proposed' as const,
                proposal: await prepareSopInputDecision(f, f.agent, input),
              }
            : await f.registry.execute(f.agent, 'review.prepare_decision', input);
        if (prepared.status !== 'proposed') throw new Error('Expected proposal');
        const proposal = prepared.proposal;
        let approved: ReturnType<typeof proposalsApprove.output.parse> | undefined;
        applying = f.registry.transaction(primary.db, async (tx) => {
          let out: RecordEnvelope;
          if (mode === 'public-approval-receipt') {
            const result = await f.registry.execute(
              f.person,
              'proposals.approve',
              { id: proposal.id, expectedPreview: proposal.decision?.previewIdentity.digest },
              {},
              tx,
            );
            if (result.status !== 'done') throw new Error('Expected approval response');
            approved = proposalsApprove.output.parse(result.output);
            expect(approved.status).toBe('approved');
            expect(approved.receipt?.recordIds).toEqual([target.id]);
            if (!approved.receipt) throw new Error('Expected durable receipt');
            out = approved.receipt.output as RecordEnvelope;
          } else {
            const checked = await revalidateSopInputDecision(
              { ...f, db: tx },
              f.person,
              proposal.id,
              proposal.decision?.previewIdentity.digest ?? '',
            );
            if (checked.status !== 'unchanged') throw new Error('Expected unchanged');
            out = await executeSopInputDecision({ ...f, db: tx }, checked.authorization);
          }
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
            "select 1 from pg_stat_activity where datname=$1 and application_name='input_decision_competitor' and wait_event_type='Lock'",
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
        if (mode === 'public-approval-receipt') {
          const retry = await f.registry.execute(f.person, 'proposals.approve', {
            id: proposal.id,
            expectedPreview: proposal.decision?.previewIdentity.digest,
          });
          expect(retry.status === 'done' && retry.output).toEqual(approved);
          expect((await f.service.get(f.person, target.id)).version).toBe(target.version + 1);
        }
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
    },
  );
});
