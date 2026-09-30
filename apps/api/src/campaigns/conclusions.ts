import {
  type ExperimentAttributes,
  experimentsConclude,
  type RunAttributes,
  type SetAttributes,
  setsCreate,
  setsGet,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';
import { recordOf } from './operations.ts';

/**
 * Conclusions and sets (plan 013c, E9 and E10): a verdict per hypothesis with its evidence, and the
 * named lists of hits one experiment hands to the next.
 */

export const conclusionOperations = [
  implement(experimentsConclude, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await recordOf(service, ctx, input.id, 'experiment', 'experiment');
      const a = record.attributes as ExperimentAttributes;
      if (a.stage !== 'running' && a.stage !== 'analysing') {
        throw new OperationError(
          'invalid_state',
          `${record.name} is ${a.stage.replace('_', ' ')}; only a running or analysing experiment is concluded`,
        );
      }
      const runs = [];
      for (const link of await service.linksTo(ctx, record.id)) {
        if (link.relation !== 'runs') continue;
        runs.push(await service.get(ctx, link.fromId));
      }
      const open = runs.filter((r) => (r.attributes as RunAttributes).status === 'in_progress');
      if (open.length) {
        throw new OperationError(
          'invalid_state',
          `${open.map((r) => r.name).join(', ')} ${open.length === 1 ? 'is' : 'are'} still in progress; finish ${open.length === 1 ? 'it' : 'them'} first`,
        );
      }
      const finished = runs.filter((r) =>
        ['done', 'failed', 'aborted'].includes((r.attributes as RunAttributes).status),
      );
      if (!finished.length) {
        throw new OperationError(
          'invalid_state',
          `${record.name} has no finished run to conclude from`,
        );
      }
      const missing = (a.hypotheses ?? []).filter(
        (h) => !(input.verdicts ?? []).some((v) => v.hypothesis === h.id),
      );
      if (missing.length) {
        throw new OperationError(
          'invalid_input',
          `Give a verdict for ${missing.map((h) => `${h.id} (${h.statement})`).join(', ')}`,
        );
      }
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...a,
          stage: 'concluded',
          conclusion: {
            summary: input.summary,
            ...(input.verdicts?.length ? { verdicts: input.verdicts } : {}),
            runs: input.runs ?? finished.map((r) => r.id),
            at: new Date().toISOString(),
            by: ctx.actor,
          },
        },
        reason: input.reason ?? `Concluded ${record.name}`,
      });
    },
  }),
  implement(setsCreate, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const { label, reason, ...attributes } = input;
      return new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'set',
        label,
        status: 'active',
        attributes: attributes satisfies SetAttributes,
        reason: reason ?? `Made the set ${label}`,
      });
    },
  }),
  implement(setsGet, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const set = await recordOf(service, ctx, input.id, 'set', 'set');
      const members = [];
      for (const m of (set.attributes as SetAttributes).members) {
        const r = await service.get(ctx, m.record);
        members.push({
          id: r.id,
          name: r.name,
          label: r.label,
          kind: r.kind,
          ...(m.note ? { note: m.note } : {}),
        });
      }
      const usedBy = [];
      for (const link of await service.linksTo(ctx, set.id)) {
        if (link.relation !== 'tests') continue;
        const e = await service.get(ctx, link.fromId);
        usedBy.push({ id: e.id, name: e.name, label: e.label });
      }
      return { set, members, usedBy };
    },
  }),
];
