import { proposalsApprove, type RecordEnvelope } from '@ailab/schema';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connect } from '../db/client.ts';
import { activity } from '../db/schema.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
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
  it.each(['private-owning-write', 'public-approval-receipt'] as const)(
    'holds actual source file/document reads through %s and caller commit',
    async (mode) => {
      const admin = new pg.Client({ connectionString: url });
      await admin.connect();
      const name = `ailab_dilution_decision_${Date.now()}`;
      await admin.query(`create database ${name}`);
      const scratch = new URL(url as string);
      scratch.pathname = `/${name}`;
      const primary = await connect(scratch.toString());
      scratch.searchParams.set('application_name', 'dilution_source_competitor');
      const competitor = await connect(scratch.toString());
      scratch.searchParams.set('application_name', 'dilution_source_retry');
      const repeatClient =
        mode === 'public-approval-receipt' ? await connect(scratch.toString()) : undefined;
      const held = signal(),
        release = signal();
      let applying: Promise<unknown> | undefined, mutation: Promise<unknown> | undefined;
      let repeated: ReturnType<ReturnType<typeof createRegistry>['execute']> | undefined;
      try {
        await primary.migrate();
        const f = await dilutionDecisionFixture(primary.db);
        const preparation =
          mode === 'private-owning-write'
            ? {
                status: 'proposed' as const,
                proposal: await prepareSopDilutionDecision(f, f.agent, f.input),
              }
            : await f.registry.execute(f.agent, 'review.prepare_decision', f.input);
        if (preparation.status !== 'proposed') throw new Error('Expected proposal');
        const proposal = preparation.proposal;
        let approved: ReturnType<typeof proposalsApprove.output.parse> | undefined;
        const delivered: unknown[] = [];
        f.bus.subscribe(f.person.labId, (entry) => delivered.push(entry));
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
            if (result.status !== 'done') throw new Error('Expected Apply result');
            approved = proposalsApprove.output.parse(result.output);
            expect(approved.status).toBe('approved');
            expect(approved.receipt?.recordIds).toEqual([f.target.id]);
            if (!approved.receipt) throw new Error('Expected durable receipt');
            out = approved.receipt.output as RecordEnvelope;
          } else {
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
            out = await executeSopDilutionDecision({ ...f, db: tx }, checked.authorization);
          }
          expect(out.attributes.questions).toMatchObject([
            { disposition: { status: 'resolved', acceptedBy: f.person.actor } },
          ]);
          held.resolve();
          expect(delivered).toEqual([]);
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
        if (repeatClient)
          repeated = createRegistry(repeatClient.db, f.kinds, new ActivityBus()).execute(
            f.person,
            'proposals.approve',
            { id: proposal.id, expectedPreview: proposal.decision?.previewIdentity.digest },
          );
        let waiting = false;
        const until = Date.now() + 10000;
        while (Date.now() < until) {
          const state = await admin.query(
            "select application_name from pg_stat_activity where datname=$1 and application_name in ('dilution_source_competitor','dilution_source_retry') and wait_event_type='Lock'",
            [name],
          );
          if (
            state.rows.some((r) => r.application_name === 'dilution_source_competitor') &&
            (!repeatClient ||
              state.rows.some((r) => r.application_name === 'dilution_source_retry'))
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
          expect(duplicate.status === 'done' && duplicate.output).toEqual(approved);
          expect(delivered).toHaveLength(1);
          expect(
            (
              await primary.db
                .select()
                .from(activity)
                .where(eq(activity.operationId, 'proposals.approve'))
            ).filter((e) => e.outcome === 'approved'),
          ).toHaveLength(1);
          const replay = await f.registry.execute(f.person, 'proposals.approve', {
            id: proposal.id,
            expectedPreview: proposal.decision?.previewIdentity.digest,
          });
          expect(replay.status === 'done' && replay.output).toEqual(approved);
          expect(delivered).toHaveLength(1);
        }
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
