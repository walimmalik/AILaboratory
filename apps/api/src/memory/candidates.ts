import {
  checkAgainFor,
  DEFAULT_BAR,
  evidenceLine,
  memoryEvidence,
  newId,
  passesBar,
  showing,
} from '@ailab/domain';
import {
  type Actor,
  type MemoryAttributes,
  type MemoryCandidate,
  type MemoryDraft,
  type MemoryObservationEntry,
  memoryCandidates as memoryCandidatesContract,
  memoryObserve,
  type RecordEnvelope,
} from '@ailab/schema';
import { and, desc, eq } from 'drizzle-orm';
import { memoryCandidates } from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { NOUN, personOf } from './match.ts';
import { labelOf } from './operations.ts';

/**
 * Memory candidates (plan 005c-1, M13, M14): one intake for every detector. Observations collect
 * under a key until they pass the bar; then a draft memory is proposed as the detector, an agent
 * working for the person whose work it saw, and a person confirms or discards it.
 */

type Row = typeof memoryCandidates.$inferSelect;

const toCandidate = (row: Row): MemoryCandidate => ({
  id: row.id,
  detector: row.detector,
  key: row.key,
  draft: row.draft,
  source: row.source,
  bar: row.bar,
  observations: row.observations,
  status: row.status,
  ...(row.memory ? { memory: row.memory } : {}),
  ...(row.proposedWith !== null ? { proposedWith: row.proposedWith } : {}),
  ...(row.quietLimit !== null ? { quietLimit: row.quietLimit } : {}),
  evidence: memoryEvidence(row.observations, NOUN[row.source], row.quietLimit ?? undefined),
});

/** Kept per candidate: every record for or against, and the latest quiet ones. */
const KEEP_QUIET = 200;

function trim(observations: MemoryObservationEntry[]): MemoryObservationEntry[] {
  const quiet = observations.filter((o) => o.finding === 'quiet');
  if (quiet.length <= KEEP_QUIET) return observations;
  const drop = new Set(
    [...quiet].sort((a, b) => a.day.localeCompare(b.day)).slice(0, quiet.length - KEEP_QUIET),
  );
  return observations.filter((o) => !drop.has(o));
}

/** A memory's fields as a draft, for a candidate that reports on an existing memory. */
function draftOf(a: MemoryAttributes): MemoryDraft {
  return {
    statement: a.statement,
    kind: a.kind,
    ...(a.about ? { about: a.about } : {}),
    ...(a.when ? { when: a.when } : {}),
    ...(a.conditions ? { conditions: a.conditions } : {}),
    ...(a.strength === 'rule' ? {} : { strength: a.strength }),
  };
}

/** What a proposed candidate's memory became: still waiting, confirmed, or discarded. */
async function outcome(
  records: RecordService,
  ctx: RecordContext,
  id: string,
): Promise<'proposed' | 'confirmed' | 'rejected'> {
  const memory = await records.get(ctx, id).catch(() => undefined);
  if (!memory) return 'rejected';
  if (memory.status === 'draft') return 'proposed';
  if (memory.status === 'active') return 'confirmed';
  // Archived: confirmed once and retired since, or never confirmed.
  const history = await records.history(ctx, id);
  return history.some((v) => v.snapshot.status === 'active') ? 'confirmed' : 'rejected';
}

export const candidateOperations = [
  implement(memoryObserve, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const records = new RecordService(deps.db, deps.kinds);
      const now = new Date();
      const finding = input.finding ?? 'for';
      const entry: MemoryObservationEntry = {
        evidence: input.evidence,
        day: input.day ?? now.toISOString().slice(0, 10),
        at: now.toISOString(),
        ...(finding === 'for' ? {} : { finding }),
        ...(input.note ? { note: input.note } : {}),
      };
      // The evidence must be a record in this lab.
      await records.get(ctx, input.evidence);
      let reported: RecordEnvelope | undefined;
      if (input.memory) {
        reported = await records.get(ctx, input.memory);
        if (reported.kind !== 'memory')
          throw new OperationError('invalid_input', `${reported.name} is not a lab memory`);
      }
      const key = input.key ?? `memory:${input.memory}`;
      const [found] = await deps.db
        .select()
        .from(memoryCandidates)
        .where(
          and(
            eq(memoryCandidates.labId, ctx.labId),
            eq(memoryCandidates.detector, input.detector),
            eq(memoryCandidates.key, key),
          ),
        );
      if (found && input.memory && found.memory !== input.memory)
        throw new OperationError(
          'invalid_input',
          `The key ${key} already collects for another pattern; leave the key out to report on the memory`,
        );
      const observations = trim([
        ...(found?.observations ?? []).filter((o) => o.evidence !== input.evidence),
        entry,
      ]);
      let status = found?.status ?? 'collecting';
      let memory = found?.memory ?? input.memory ?? null;
      if (memory && (status === 'proposed' || !found)) status = await outcome(records, ctx, memory);
      const bar = input.bar ?? found?.bar ?? DEFAULT_BAR;
      const draft =
        input.draft ?? found?.draft ?? draftOf(reported?.attributes as MemoryAttributes);
      const quietLimit = input.quietLimit ?? found?.quietLimit ?? null;
      let proposed: RecordEnvelope | undefined;
      let proposedWith = found?.proposedWith ?? null;
      const shown = showing(observations);
      if (
        !input.memory &&
        (status === 'collecting' || status === 'rejected') &&
        passesBar(shown, bar, status === 'rejected' ? (proposedWith ?? 0) : undefined)
      ) {
        const detector: Actor = {
          type: 'agent',
          agentName: `Lab memory detector (${input.detector})`,
          onBehalfOf: personOf(ctx),
        };
        const evidence = [...new Set(shown.map((o) => o.evidence))];
        const line = evidenceLine(shown, NOUN[input.source]);
        const today = now.toISOString().slice(0, 10);
        const checkAgain = checkAgainFor(draft.kind, today);
        const attributes: MemoryAttributes = {
          ...draft,
          strength: draft.strength ?? 'note',
          appliesTo: { to: 'lab' },
          source: { from: input.source, evidence: evidence.slice(-50), note: line },
          ...(checkAgain ? { checkAgain } : {}),
        };
        proposed = await records.create(
          { ...ctx, actor: detector },
          {
            kind: 'memory',
            label: labelOf(draft.statement),
            attributes,
            reason: `Proposed by ${input.detector}: ${line}`,
          },
        );
        memory = proposed.id;
        proposedWith = evidence.length;
        status = 'proposed';
      }
      const values = {
        draft,
        source: input.source,
        bar,
        observations,
        status,
        memory,
        proposedWith,
        quietLimit,
        updatedAt: now,
      };
      const [row] = found
        ? await deps.db
            .update(memoryCandidates)
            .set(values)
            .where(eq(memoryCandidates.id, found.id))
            .returning()
        : await deps.db
            .insert(memoryCandidates)
            .values({
              id: newId('mcd'),
              orgId: ctx.orgId,
              labId: ctx.labId,
              detector: input.detector,
              key,
              ...values,
            })
            .returning();
      return { candidate: toCandidate(row as Row), ...(proposed ? { proposed } : {}) };
    },
  }),
  implement(memoryCandidatesContract, {
    run: async (ctx, input, deps) => {
      const records = new RecordService(deps.db, deps.kinds);
      const rows = await deps.db
        .select()
        .from(memoryCandidates)
        .where(
          and(
            eq(memoryCandidates.labId, ctx.labId),
            input.detector ? eq(memoryCandidates.detector, input.detector) : undefined,
          ),
        )
        .orderBy(desc(memoryCandidates.updatedAt));
      const candidates: MemoryCandidate[] = [];
      for (const row of rows) {
        const status =
          row.status === 'proposed' && row.memory
            ? await outcome(records, ctx, row.memory)
            : row.status;
        if (input.status && status !== input.status) continue;
        candidates.push({ ...toCandidate(row), status });
        if (candidates.length >= (input.limit ?? 50)) break;
      }
      return { candidates };
    },
  }),
];
