import {
  type CapabilityId,
  type Configuration,
  type ConfigurationChange,
  capabilityCatalog,
  InstrumentAttributes,
  instrumentsCapabilities,
  instrumentsChangeConfiguration,
  instrumentsLogService,
  instrumentsRegister,
  instrumentsResolve,
  instrumentsSetStatus,
  ROOT_NODE,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { proposeIfActive } from '../operations/record-operations.ts';
import { implement } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { type Lookup, resolveWith } from './resolve.ts';

/** The record service as a lookup for the resolver: missing and other labs' records read as undefined. */
function lookupOf(service: RecordService, ctx: RecordContext): Lookup {
  return {
    get: async (id) => {
      try {
        return await service.get(ctx, id);
      } catch (error) {
        if (error instanceof RecordError && error.code === 'not_found') return undefined;
        throw error;
      }
    },
    list: (kind) => service.list(ctx, { kind, limit: 500 }),
  };
}

async function instrumentKindOf(service: RecordService, ctx: RecordContext, id: string) {
  const record = await service.get(ctx, id);
  if (record.kind !== 'instrument_kind' || record.status === 'archived') {
    throw new OperationError(
      'invalid_input',
      `${record.name} is ${record.status === 'archived' ? 'archived' : 'not an instrument kind'}`,
    );
  }
  return record;
}

async function instrumentOf(service: RecordService, ctx: RecordContext, id: string) {
  const record = await service.get(ctx, id);
  if (record.kind !== 'instrument') {
    throw new OperationError('invalid_input', `${record.name} is not a registered instrument`);
  }
  return { record, attributes: InstrumentAttributes.parse(record.attributes) };
}

/** Resolves a configuration of an instrument kind with what the lab has (see resolveWith). */
async function resolveIn(
  service: RecordService,
  ctx: RecordContext,
  kindId: string,
  configuration: Configuration,
  self?: string,
) {
  const kind = await instrumentKindOf(service, ctx, kindId);
  return resolveWith(lookupOf(service, ctx), kind, configuration, self);
}

/** Refuses a configuration with errors, naming every one. */
function mustResolve(resolved: Awaited<ReturnType<typeof resolveIn>>) {
  const errors = resolved.issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new OperationError(
      'invalid_input',
      `The configuration doesn't work: ${errors.map((e) => e.message).join('; ')}`,
      { issues: errors },
    );
  }
}

/** Applies typed changes to a configuration, refusing changes that name nothing or orphan children. */
export function applyChanges(configuration: Configuration, changes: ConfigurationChange[]) {
  let nodes = [...configuration.equipment];
  const index = (id: string) => {
    const at = nodes.findIndex((n) => n.id === id);
    if (at < 0) throw new OperationError('invalid_input', `Nothing called "${id}" is installed`);
    return at;
  };
  for (const change of changes) {
    switch (change.change) {
      case 'place':
        if (change.equipment.id === ROOT_NODE || nodes.some((n) => n.id === change.equipment.id)) {
          throw new OperationError(
            'invalid_input',
            `Something called "${change.equipment.id}" is already installed; choose another id`,
          );
        }
        nodes.push(change.equipment);
        break;
      case 'move': {
        const at = index(change.id);
        const { parent: _old, ...rest } = nodes[at] as (typeof nodes)[number];
        nodes[at] = {
          ...rest,
          mount: change.mount,
          placement: change.placement,
          ...(change.parent ? { parent: change.parent } : {}),
        };
        break;
      }
      case 'remove': {
        index(change.id);
        const children = nodes.filter((n) => n.parent === change.id).map((n) => n.id);
        if (children.length > 0) {
          throw new OperationError(
            'invalid_input',
            `Remove what sits on "${change.id}" first: ${children.join(', ')}`,
          );
        }
        nodes = nodes.filter((n) => n.id !== change.id);
        break;
      }
      case 'set_item': {
        const at = index(change.id);
        const { item: _old, ...rest } = nodes[at] as (typeof nodes)[number];
        nodes[at] = { ...rest, ...(change.item ? { item: change.item } : {}) };
        break;
      }
    }
  }
  return { equipment: nodes };
}

export const instrumentOperations = [
  implement(instrumentsCapabilities, {
    run: async () => ({
      capabilities: (Object.keys(capabilityCatalog) as CapabilityId[]).map((id) => ({
        id,
        ...capabilityCatalog[id],
      })),
    }),
  }),
  implement(instrumentsResolve, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      if ('instrument' in input) {
        const { record, attributes } = await instrumentOf(service, ctx, input.instrument);
        return resolveIn(service, ctx, attributes.kind, attributes.configuration, record.id);
      }
      return resolveIn(service, ctx, input.instrumentKind, input.configuration);
    },
  }),
  implement(instrumentsRegister, {
    agentPolicy: 'direct',
    run: async (ctx, { label, reason, configuration, ...rest }, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const config = configuration ?? { equipment: [] };
      mustResolve(await resolveIn(service, ctx, rest.kind, config));
      return service.create(ctx, {
        kind: 'instrument',
        label,
        attributes: { ...rest, configuration: config, status: 'ready' },
        reason: reason ?? `Registered ${label}`,
      });
    },
  }),
  implement(instrumentsChangeConfiguration, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { record, attributes } = await instrumentOf(service, ctx, input.id);
      const configuration = applyChanges(attributes.configuration, input.changes);
      mustResolve(await resolveIn(service, ctx, attributes.kind, configuration, record.id));
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...record.attributes, configuration },
        reason: input.reason ?? 'Configuration changed',
      });
    },
  }),
  implement(instrumentsSetStatus, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { record } = await instrumentOf(service, ctx, input.id);
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...record.attributes, status: input.status },
        reason: input.reason ?? `Status set to ${input.status.replaceAll('_', ' ')}`,
      });
    },
  }),
  implement(instrumentsLogService, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { record } = await instrumentOf(service, ctx, input.id);
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...record.attributes,
          lastService: { date: input.date, note: input.note },
          ...(input.calibrationDue ? { calibrationDue: input.calibrationDue } : {}),
        },
        reason: `Service ${input.date}: ${input.note}`,
      });
    },
  }),
];
