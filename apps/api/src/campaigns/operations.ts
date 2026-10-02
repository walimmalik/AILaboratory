import {
  type AssayTemplateAttributes,
  type CampaignAttributes,
  type CampaignStage,
  campaignsDraft,
  campaignsSetStage,
  type ExperimentAttributes,
  type ExperimentStage,
  experimentsAdoptVersions,
  experimentsBindProtocol,
  experimentsCalculate,
  experimentsDraft,
  experimentsPlanCheck,
  experimentsSetStage,
  experimentsWhereUsed,
  type ProtocolStep,
  type RecordEnvelope,
  type RunAttributes,
  type SopAttributes,
} from '@ailab/schema';
import type { z } from 'zod';
import { OperationError } from '../operations/errors.ts';
import { proposeIfActive } from '../operations/record-operations.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import { stable } from '../records/pins.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

type PlanBlocker = z.infer<typeof experimentsPlanCheck.output>['blockers'][number];

/**
 * What planning needs beyond the experiment's readiness and amounts (UX review 2026-10-02, #1):
 * something to test, and confirmed plate maps. A template with a layout needs at least one plate
 * map; every plate map drafted for the experiment (linked `part_of` it) must be confirmed.
 */
async function planBlockers(
  service: RecordService,
  ctx: RecordContext,
  record: RecordEnvelope,
): Promise<PlanBlocker[]> {
  const a = record.attributes as ExperimentAttributes;
  const blockers: PlanBlocker[] = [];
  if ((a.subjects ?? []).length === 0) {
    blockers.push({
      message: 'What is tested is not chosen yet: add the samples, compounds or constructs',
    });
  }
  const maps: RecordEnvelope[] = [];
  for (const link of await service.linksTo(ctx, record.id)) {
    if (link.relation !== 'part_of') continue;
    const from = await service.get(ctx, link.fromId);
    if (from.kind === 'plate_map' && from.status !== 'archived') maps.push(from);
  }
  if (maps.length === 0 && a.template) {
    const template = await service.getVersion(ctx, a.template.id, a.template.version);
    if ((template.snapshot.attributes as AssayTemplateAttributes).layout) {
      blockers.push({
        message: `No plate map yet; ${template.snapshot.name} lays its plates out from a layout`,
      });
    }
  }
  for (const map of maps) {
    if (map.status !== 'active') {
      blockers.push({
        message: `Plate map ${map.label} (${map.name}) is a draft; confirm it first`,
        record: map.id,
      });
    }
  }
  return blockers;
}

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

export async function recordOf(
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

type Calculated = z.infer<typeof experimentsCalculate.output>;

/** Each protocol part worked out at its pinned SOP version with the pinned bindings (013b). */
export async function calculateExperiment(
  deps: OperationDeps,
  ctx: RecordContext,
  record: RecordEnvelope,
): Promise<Calculated> {
  const a = record.attributes as ExperimentAttributes;
  const parts: Calculated['parts'] = [];
  for (const p of a.protocol) {
    const result = await deps.registry.execute(
      ctx,
      'sops.calculate',
      {
        sop: p.sop.id,
        version: p.sop.version,
        ...(p.bindings ? { bindings: p.bindings } : {}),
        ...(p.inputs ? { inputs: p.inputs } : {}),
      },
      {},
      deps.db,
    );
    if (result.status !== 'done') throw new Error(`sops.calculate was ${result.status}`);
    const out = result.output as Omit<Calculated['parts'][number], 'part' | 'sop' | 'problems'>;
    const sop = await new RecordService(deps.db, deps.kinds).get(ctx, p.sop.id);
    parts.push({
      part: p.id,
      sop: { id: sop.id, name: sop.name, version: p.sop.version },
      ...out,
      problems: [
        ...out.bindings.flatMap((b) => (b.problem ? [`${p.id}: ${b.problem}`] : [])),
        ...out.variables.flatMap((v) =>
          v.ok ? [] : [`${p.id}: ${v.name} ${v.problem ?? v.error ?? 'has no value'}`],
        ),
      ],
    });
  }
  return { parts, ready: parts.every((p) => p.problems.length === 0) };
}

/** Campaign and experiment operations (plan 013a, 013b). */
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
      if (input.stage === 'concluded' && NEXT[a.stage].includes('concluded')) {
        throw new OperationError(
          'invalid_input',
          `Conclude ${record.name} with experiments.conclude, which records a verdict per hypothesis`,
        );
      }
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
        const blockers = await planBlockers(service, ctx, record);
        if (blockers.length) {
          throw new OperationError(
            'not_ready',
            `${record.name} is not ready to plan: ${blockers.map((b) => b.message).join('; ')}`,
          );
        }
        const calculated = await calculateExperiment(deps, ctx, record);
        if (!calculated.ready) {
          throw new OperationError(
            'not_ready',
            `${record.name}'s protocol doesn't work out yet: ${calculated.parts.flatMap((p) => p.problems).join('; ')}`,
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
  implement(experimentsBindProtocol, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await recordOf(service, ctx, input.id, 'experiment', 'experiment');
      const a = record.attributes as ExperimentAttributes;
      const part = a.protocol.find((p) => p.id === input.part);
      if (!part) {
        throw new OperationError(
          'invalid_input',
          `${record.name} has no protocol part ${input.part}; it has ${a.protocol.map((p) => p.id).join(', ') || 'none'}`,
        );
      }
      const given = new Set((input.bindings ?? []).map((b) => b.role));
      const drop = new Set(input.unbind ?? []);
      const bindings = [
        ...(part.bindings ?? []).filter((b) => !given.has(b.role) && !drop.has(b.role)),
        ...(input.bindings ?? []),
      ];
      const named = new Set((input.inputs ?? []).map((i) => i.name));
      const clear = new Set(input.clear ?? []);
      const inputs = [
        ...(part.inputs ?? []).filter((i) => !named.has(i.name) && !clear.has(i.name)),
        ...(input.inputs ?? []),
      ];
      const { bindings: _b, inputs: _i, ...rest } = part;
      const next = {
        ...rest,
        ...(bindings.length ? { bindings } : {}),
        ...(inputs.length ? { inputs } : {}),
      };
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...a, protocol: a.protocol.map((p) => (p.id === part.id ? next : p)) },
        reason: input.reason ?? `Bound the ${part.id} part of ${record.name}`,
      });
    },
  }),
  implement(experimentsCalculate, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await recordOf(service, ctx, input.id, 'experiment', 'experiment');
      if (input.version === undefined) return calculateExperiment(deps, ctx, record);
      const at = (await service.history(ctx, record.id)).find((v) => v.version === input.version);
      if (!at) {
        throw new OperationError('invalid_input', `${record.name} has no version ${input.version}`);
      }
      return calculateExperiment(deps, ctx, at.snapshot);
    },
  }),
  implement(experimentsPlanCheck, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await recordOf(service, ctx, input.id, 'experiment', 'experiment');
      const blockers = await planBlockers(service, ctx, record);
      return { ready: blockers.length === 0, blockers };
    },
  }),
  implement(experimentsAdoptVersions, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await recordOf(service, ctx, input.id, 'experiment', 'experiment');
      const a = record.attributes as ExperimentAttributes;
      const moved: string[] = [];
      const dropped: string[] = [];
      /** The latest confirmed version, when it changed something since the pinned one. */
      const newer = async (id: string, version: number) => {
        const now = await service.get(ctx, id);
        if (now.status !== 'active' || now.version <= version) return undefined;
        const [pinned] = (await service.history(ctx, id)).filter((v) => v.version === version);
        if (stable(now.attributes) === stable(pinned?.snapshot.attributes)) return undefined;
        moved.push(`${now.name} v${version} → v${now.version}`);
        return now;
      };
      const protocol: ProtocolStep[] = [];
      for (const p of a.protocol) {
        const sop = await newer(p.sop.id, p.sop.version);
        const next: ProtocolStep = {
          ...p,
          ...(sop ? { sop: { id: sop.id, version: sop.version } } : {}),
        };
        if (sop) {
          const s = sop.attributes as SopAttributes;
          const keep = next.bindings?.filter((b) => s.materials.some((m) => m.role === b.role));
          const inputs = next.inputs?.filter((i) =>
            s.variables.some((v) => v.name === i.name && v.kind !== 'computed'),
          );
          for (const b of next.bindings ?? [])
            if (!keep?.includes(b)) dropped.push(`${p.id}: role ${b.role}`);
          for (const i of next.inputs ?? [])
            if (!inputs?.includes(i)) dropped.push(`${p.id}: input ${i.name}`);
          delete next.bindings;
          delete next.inputs;
          if (keep?.length) next.bindings = keep;
          if (inputs?.length) next.inputs = inputs;
        }
        if (next.bindings) {
          const bindings = [];
          for (const b of next.bindings) {
            const now = b.version === undefined ? undefined : await newer(b.record, b.version);
            bindings.push(now ? { ...b, version: now.version } : b);
          }
          next.bindings = bindings;
        }
        protocol.push(next);
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
        reason:
          input.reason ??
          `Adopted ${moved.join(', ')}${dropped.length ? `; dropped what the new SOP versions no longer have (${dropped.join(', ')})` : ''}`,
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
