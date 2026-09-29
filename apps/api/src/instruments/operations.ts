import { type KindInfo, resolveConfiguration } from '@ailab/domain';
import {
  type CapabilityId,
  capabilityCatalog,
  EquipmentKindAttributes,
  InstrumentKindAttributes,
  instrumentsCapabilities,
  instrumentsResolve,
  type RecordEnvelope,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import { RecordService } from '../records/service.ts';

const infoOf = <A>(record: RecordEnvelope, attributes: A): KindInfo<A> => ({
  label: record.label,
  attributes,
  confirmed: record.status === 'active',
});

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
      const record = await service.get(ctx, input.instrumentKind);
      if (record.kind !== 'instrument_kind' || record.status === 'archived') {
        throw new OperationError(
          'invalid_input',
          `${record.name} is ${record.status === 'archived' ? 'archived' : 'not an instrument kind'}`,
        );
      }
      const equipment = new Map<string, KindInfo<EquipmentKindAttributes>>();
      for (const kindId of new Set(input.configuration.equipment.map((n) => n.kind))) {
        try {
          const found = await service.get(ctx, kindId);
          // Anything else is reported by the resolver as an unknown kind.
          if (found.kind === 'equipment_kind' && found.status !== 'archived') {
            equipment.set(kindId, infoOf(found, EquipmentKindAttributes.parse(found.attributes)));
          }
        } catch (error) {
          if (!(error instanceof RecordError && error.code === 'not_found')) throw error;
        }
      }
      return resolveConfiguration({
        instrument: infoOf(record, InstrumentKindAttributes.parse(record.attributes)),
        equipment,
        configuration: input.configuration,
      });
    },
  }),
];
