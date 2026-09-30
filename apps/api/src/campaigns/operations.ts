import {
  type CampaignAttributes,
  type CampaignStage,
  campaignsDraft,
  campaignsSetStage,
  type ExperimentAttributes,
  type ExperimentStage,
  experimentsAdoptVersions,
  experimentsDraft,
  experimentsSetStage,
  experimentsWhereUsed,
  type RecordEnvelope,
  type RunAttributes,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { proposeIfActive } from '../operations/record-operations.ts';
import { implement } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import { stable } from '../records/pins.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

/** Stages an experiment may move to from each stage (E4). */
const NEXT: Record<ExperimentStage, ExperimentStage[]> = {
  designing: ['planned', 'on_hold', 'cancelled'],
  planned: ['designing', 'running', 'on_hold', 'cancelled'],
  running: ['analysing', 'on_hold', 'cancelled'],
  analysing: ['running', 'concluded', 'on_hold', 'cancelled'],
  on_hold: ['designing', 'planned', 'running', 'analysing', 'cancelled'],
  concluded: [],
  cancelled: [],
};

const STAGE_WORDS: Record<string, string> = { on_hold: 'on hold' };
const words = (stage: string) => STAGE_WORDS[stage] ?? stage;

async function recordOf(
  service: RecordService,
  ctx: RecordContext,
  id: string,
  kind: string,
  noun: string,
): Promise<RecordEnvelope> {
  const record = await service.get(ctx, id).catch((error: unknown) => {
    if (error instanceof RecordError && error.code === 'not_found') return undefined;
    throw error;
  });
  if (record?.kind !== kind) throw new OperationError('not_found', `No ${noun} ${id} in this lab`);
  return record;
}

/** Campaign and experiment operations (plan 013a). */
export const campaignOperations = [
  implement(campaignsDraft, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'campaign',
        label,
        attributes: { ...attributes, aims: attributes.aims ?? [], stage: 'proposed' },
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the campaign ${label}`,
      }),
  }),
  implement(campaignsSetStage, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await recordOf(service, ctx, input.id, 'campaign', 'campaign');
      const a = record.attributes as CampaignAttributes;
      if (a.stage === input.stage) {
        throw new OperationError('invalid_input', `${record.name} is already ${input.stage}`);
      }
      if (input.stage === 'active' && record.status !== 'active') {
        throw new OperationError(
          'invalid_state',
          `${record.name} is a draft; confirm it before it becomes active`,
        );
      }
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...a, stage: input.stage satisfies CampaignStage },
        reason: input.reason ?? `Moved ${record.name} from ${a.stage} to ${input.stage}`,
      });
    },
  }),
  implement(experimentsDraft, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'experiment',
        label,
        attributes: { ...attributes, protocol: attributes.protocol ?? [], stage: 'designing' },
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the experiment ${label}`,
      }),
  }),
  implement(experimentsSetStage, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await recordOf(service, ctx, input.id, 'experiment', 'experiment');
      const a = record.attributes as ExperimentAttributes;
      if (!NEXT[a.stage].includes(input.stage)) {
        const allowed = NEXT[a.stage].map(words);
        throw new OperationError(
          'invalid_state',
          `${record.name} is ${words(a.stage)}; ${
            allowed.length
              ? `it can move to ${allowed.join(', ')}`
              : 'that is final; start a follow-up experiment instead'
          }`,
        );
      }
      if (input.stage === 'planned') {
        if (record.status !== 'active') {
          throw new OperationError(
            'invalid_state',
            `${record.name} is a draft; a person confirms its design before it is planned`,
          );
        }
        const readiness = await service.readiness(ctx, record.id);
        if (!readiness.ready) {
          throw new OperationError(
            'not_ready',
            `${record.name} is not ready to plan: ${readiness.missing.join('; ')}`,
          );
        }
      }
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...a, stage: input.stage },
        reason:
          input.reason ?? `Moved ${record.name} from ${words(a.stage)} to ${words(input.stage)}`,
      });
    },
  }),
  implement(experimentsAdoptVersions, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await recordOf(service, ctx, input.id, 'experiment', 'experiment');
      const a = record.attributes as ExperimentAttributes;
      const moved: string[] = [];
      const protocol = [];
      for (const p of a.protocol) {
        const sop = await service.get(ctx, p.sop.id);
        const [pinned] = (await service.history(ctx, p.sop.id)).filter(
          (v) => v.version === p.sop.version,
        );
        const changed =
          sop.status === 'active' &&
          sop.version > p.sop.version &&
          stable(sop.attributes) !== stable(pinned?.snapshot.attributes);
        if (changed) moved.push(`${sop.name} v${p.sop.version} → v${sop.version}`);
        protocol.push(changed ? { ...p, sop: { id: sop.id, version: sop.version } } : p);
      }
      if (moved.length === 0) {
        throw new OperationError(
          'invalid_input',
          `${record.name} already follows the latest confirmed versions`,
        );
      }
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...a, protocol },
        reason: input.reason ?? `Adopted ${moved.join(', ')}`,
      });
    },
  }),
  implement(experimentsWhereUsed, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const target = await service.get(ctx, input.record).catch((error: unknown) => {
        if (error instanceof RecordError && error.code === 'not_found') {
          throw new OperationError('not_found', `No record ${input.record} in this lab`);
        }
        throw error;
      });
      const byId = new Map<string, RecordEnvelope>();
      const load = async (id: string) => {
        const cached = byId.get(id);
        if (cached) return cached;
        const r = await service.get(ctx, id);
        byId.set(id, r);
        return r;
      };
      const use = (r: RecordEnvelope, how: string) => {
        const stage = (r.attributes as { stage?: string }).stage;
        return {
          id: r.id,
          name: r.name,
          label: r.label,
          ...(stage
            ? { stage }
            : r.kind === 'run'
              ? { stage: (r.attributes as RunAttributes).status }
              : {}),
          how,
        };
      };
      /** How an experiment design (at some version) uses the target, if it does. */
      const usesIn = (a: ExperimentAttributes): string | undefined => {
        const pins = a.protocol.filter(
          (p) =>
            p.sop.id === target.id &&
            (input.version === undefined || p.sop.version === input.version),
        );
        if (pins.length) return pins.map((p) => `follows v${p.sop.version}`).join(', ');
        if (input.version !== undefined) return undefined;
        if (a.campaign === target.id) return 'part of it';
        if (a.followsUp?.experiment === target.id) return a.followsUp.relation.replaceAll('_', ' ');
        if (a.subjects?.some((s) => s.record === target.id)) return 'tests it';
        const control = a.controls?.find((c) => c.subject === target.id);
        if (control) return `${control.role} control`;
        const doc = a.documents?.find((d) => d.document === target.id);
        if (doc) return doc.use === 'follows' ? 'follows it' : 'cites it';
        return undefined;
      };

      const out = { campaigns: [], experiments: [], runs: [] } as {
        campaigns: ReturnType<typeof use>[];
        experiments: ReturnType<typeof use>[];
        runs: ReturnType<typeof use>[];
      };
      for (const link of await service.linksTo(ctx, target.id)) {
        const from = await load(link.fromId);
        if (from.kind === 'campaign' && input.version === undefined) {
          out.campaigns.push(use(from, link.relation === 'about' ? 'about it' : 'cites it'));
        }
        if (from.kind === 'experiment') {
          const how = usesIn(from.attributes as ExperimentAttributes);
          if (how) out.experiments.push(use(from, how));
        }
        if (from.kind === 'run') {
          const pin = (from.attributes as RunAttributes).experiment;
          if (input.version === undefined || pin.version === input.version)
            out.runs.push(use(from, `runs v${pin.version}`));
        }
      }
      // Runs reach an SOP or subject through the experiment version they ran.
      const experiments = new Set(
        (await service.linksTo(ctx, target.id))
          .filter((l) => l.relation !== 'runs')
          .map((l) => l.fromId),
      );
      for (const experimentId of experiments) {
        if ((await load(experimentId)).kind !== 'experiment') continue;
        const history = await service.history(ctx, experimentId);
        for (const link of await service.linksTo(ctx, experimentId)) {
          if (link.relation !== 'runs') continue;
          const runRecord = await load(link.fromId);
          const pin = (runRecord.attributes as RunAttributes).experiment;
          const ran = history.find((v) => v.version === pin.version)?.snapshot;
          const how = ran && usesIn(ran.attributes as ExperimentAttributes);
          if (how) out.runs.push(use(runRecord, `${how} (ran v${pin.version} of ${ran.name})`));
        }
      }
      return out;
    },
  }),
];
