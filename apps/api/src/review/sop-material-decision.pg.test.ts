import { proposalsApprove, type RecordEnvelope } from '@ailab/schema';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connect } from '../db/client.ts';
import { activity } from '../db/schema.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
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
  it.each(['private-owning-write', 'public-approval-receipt'] as const)(
    'holds actual indirect reads through %s and caller commit',
    async (mode) => {
      const admin = new pg.Client({ connectionString: url });
      await admin.connect();
      const name = `ailab_material_decision_${Date.now()}`;
      await admin.query(`create database ${name}`);
      const scratch = new URL(url as string);
      scratch.pathname = `/${name}`;
      const primary = await connect(scratch.toString());
      scratch.searchParams.set('application_name', 'material_decision_competitor');
      const competitor = await connect(scratch.toString());
      scratch.searchParams.set('application_name', 'material_decision_retry');
      const repeatClient =
        mode === 'public-approval-receipt' ? await connect(scratch.toString()) : undefined;
      const held = signal(),
        release = signal();
      let mutation: Promise<unknown> | undefined, applying: Promise<unknown> | undefined;
      let repeated: ReturnType<ReturnType<typeof createRegistry>['execute']> | undefined;
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
              requirements: 'Declared plate requirements',
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
        const input = {
          sop: target.id,
          expectedVersion: target.version,
          question: 'plate',
          reason: 'Require explicit material choice',
        };
        const prepared =
          mode === 'private-owning-write'
            ? {
                status: 'proposed' as const,
                proposal: await prepareSopMaterialDecision(f, f.agent, input),
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
            const checked = await revalidateSopMaterialDecision(
              { ...f, db: tx },
              f.person,
              proposal.id,
              proposal.decision?.previewIdentity.digest ?? '',
            );
            if (checked.status !== 'unchanged') throw new Error('Expected unchanged');
            out = await executeSopMaterialDecision({ ...f, db: tx }, checked.authorization);
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
        if (repeatClient)
          repeated = createRegistry(repeatClient.db, f.kinds, new ActivityBus()).execute(
            f.person,
            'proposals.approve',
            { id: proposal.id, expectedPreview: proposal.decision?.previewIdentity.digest },
          );
        let waiting = false;
        const until = Date.now() + 10_000;
        while (Date.now() < until) {
          const state = await admin.query(
            "select application_name from pg_stat_activity where datname=$1 and application_name in ('material_decision_competitor','material_decision_retry') and wait_event_type='Lock'",
            [name],
          );
          if (
            state.rows.some((r) => r.application_name === 'material_decision_competitor') &&
            (!repeatClient ||
              state.rows.some((r) => r.application_name === 'material_decision_retry'))
          ) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
        release.resolve();
        await applying;
        await mutation;
        if (repeated) {
          const duplicate = await repeated;
          expect(duplicate.status).toBe('done');
          expect(duplicate.status === 'done' && duplicate.output).toEqual(approved);
        }
        if (mode === 'public-approval-receipt') {
          const retry = await f.registry.execute(f.person, 'proposals.approve', {
            id: proposal.id,
            expectedPreview: proposal.decision?.previewIdentity.digest,
          });
          expect(retry.status === 'done' && retry.output).toEqual(approved);
          expect((await f.service.get(f.person, target.id)).version).toBe(target.version + 1);
          expect(
            (
              await primary.db
                .select()
                .from(activity)
                .where(eq(activity.operationId, 'proposals.approve'))
            ).filter((e) => e.outcome === 'approved'),
          ).toHaveLength(1);
        }
        expect((await f.service.get(f.person, target.id)).attributes.questions).toMatchObject([
          { disposition: { status: 'deferred' } },
        ]);
      } finally {
        release.resolve();
        await Promise.allSettled(
          [applying, mutation, repeated].filter((p): p is Promise<unknown> => !!p),
        );
        await repeatClient?.close();
        await competitor.close();
        await primary.close();
        await admin.query(`drop database ${name}`);
        await admin.end();
      }
    },
  );
});
