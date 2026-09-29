import { computeWells, fromOpentrons, LabwareError, toOpentrons } from '@ailab/domain';
import {
  type EvidenceInput,
  LabwareTypeAttributes,
  labwareExportOpentrons,
  labwareImportOpentrons,
  labwareWells,
  type RecordEnvelope,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';
import { RecordService } from '../records/service.ts';

/** Reads a labware type's attributes, refusing records of another kind. */
async function labwareTypeOf(service: RecordService, ctx: RecordContext, id: string) {
  const record = await service.get(ctx, id);
  if (record.kind !== 'labware_type') {
    throw new OperationError('invalid_input', `${record.name} is not a labware type`);
  }
  return { record, attributes: LabwareTypeAttributes.parse(record.attributes) };
}

/** The vendor record with this name, created as a draft when the lab has none yet. */
async function vendorNamed(
  service: RecordService,
  ctx: RecordContext,
  name: string,
  reason: string,
): Promise<RecordEnvelope> {
  const found = await service.list(ctx, { kind: 'vendor', search: name, limit: 50 });
  const match = found.find((v) => v.label.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    match ?? (await service.create(ctx, { kind: 'vendor', label: name, attributes: {}, reason }))
  );
}

function refusal(error: unknown): never {
  if (error instanceof LabwareError) {
    throw new OperationError(
      error.code === 'unsupported' ? 'invalid_input' : 'not_ready',
      error.message,
    );
  }
  throw error;
}

export const labwareOperations = [
  implement(labwareWells, {
    run: async (ctx, input, deps) => {
      const { attributes } = await labwareTypeOf(
        new RecordService(deps.db, deps.kinds),
        ctx,
        input.id,
      );
      return { wells: attributes.wells ? computeWells(attributes.wells, input.order) : [] };
    },
  }),
  implement(labwareImportOpentrons, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      let imported: ReturnType<typeof fromOpentrons>;
      try {
        imported = fromOpentrons(input.definition);
      } catch (error) {
        refusal(error);
      }
      const service = new RecordService(deps.db, deps.kinds);
      const { namespace, version, parameters } = input.definition;
      const reference = `Opentrons labware definition ${namespace}/${parameters.loadName}/${version}`;
      const reason = input.reason ?? `Imported from the ${reference}`;
      const vendor = await vendorNamed(service, ctx, imported.brand, reason);
      const attributes = { ...imported.attributes, manufacturer: vendor.id };
      const evidence: Record<string, EvidenceInput> = Object.fromEntries(
        Object.keys(attributes).map((field) => [field, { source: 'imported', reference }]),
      );
      return service.create(ctx, {
        kind: 'labware_type',
        label: imported.label,
        attributes,
        evidence,
        reason,
      });
    },
  }),
  implement(labwareExportOpentrons, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { record, attributes } = await labwareTypeOf(service, ctx, input.id);
      const brand = attributes.manufacturer
        ? (await service.get(ctx, attributes.manufacturer)).label
        : undefined;
      try {
        return { definition: toOpentrons(attributes, { label: record.label, brand }) };
      } catch (error) {
        refusal(error);
      }
    },
  }),
];
