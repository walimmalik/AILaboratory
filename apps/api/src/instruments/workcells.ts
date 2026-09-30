import {
  type WorkcellAttributes,
  type WorkcellMember,
  workcellsChangeMembers,
  workcellsDraft,
  workcellsOfInstrument,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { proposeIfActive } from '../operations/record-operations.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';

/** Workcell operations (plan 008d); the kind and its checks are in `workcell-kind.ts`. */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

export const workcellOperations = [
  implement(workcellsDraft, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      service(deps).create(ctx, {
        kind: 'workcell',
        label,
        attributes: attributes satisfies WorkcellAttributes,
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the workcell ${label}`,
      }),
  }),
  implement(workcellsChangeMembers, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const record = await records.get(ctx, input.id).catch(() => undefined);
      if (record?.kind !== 'workcell')
        throw new OperationError('not_found', `${input.id} is not a workcell in this lab`);
      const a = record.attributes as WorkcellAttributes;
      const missing = (input.remove ?? []).filter(
        (id) => !a.members.some((m) => m.instrument === id),
      );
      if (missing.length)
        throw new OperationError(
          'invalid_input',
          `${record.name} has no member ${missing.join(', ')}`,
        );
      const set = new Map((input.set ?? []).map((m) => [m.instrument, m]));
      const members: WorkcellMember[] = [
        ...a.members
          .filter((m) => !input.remove?.includes(m.instrument))
          .map((m) => set.get(m.instrument) ?? m),
        ...(input.set ?? []).filter((m) => !a.members.some((o) => o.instrument === m.instrument)),
      ];
      if (!members.length)
        throw new OperationError(
          'invalid_input',
          `${record.name} would have no members; archive it instead`,
        );
      return records.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...a, members },
        reason:
          input.reason ??
          [
            input.set?.length
              ? `Set ${input.set.length} member${input.set.length === 1 ? '' : 's'}`
              : '',
            input.remove?.length ? `removed ${input.remove.length}` : '',
          ]
            .filter(Boolean)
            .join(', '),
      });
    },
  }),
  implement(workcellsOfInstrument, {
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const instrument = await records.get(ctx, input.instrument).catch(() => undefined);
      if (instrument?.kind !== 'instrument')
        throw new OperationError(
          'not_found',
          `${input.instrument} is not an instrument in this lab`,
        );
      const all = await records.list(ctx, { kind: 'workcell', limit: 1000 });
      let active: { id: string; name: string; label: string; member: WorkcellMember } | undefined;
      const drafts: { id: string; name: string; label: string }[] = [];
      for (const w of all) {
        const member = (w.attributes as WorkcellAttributes).members.find(
          (m) => m.instrument === instrument.id,
        );
        if (!member) continue;
        if (w.status === 'active') active = { id: w.id, name: w.name, label: w.label, member };
        else if (w.status === 'draft') drafts.push({ id: w.id, name: w.name, label: w.label });
      }
      return { ...(active ? { active } : {}), drafts };
    },
  }),
];
