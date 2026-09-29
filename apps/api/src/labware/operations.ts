import {
  computeWells,
  fromOpentrons,
  LabwareError,
  sbsPositions,
  toOpentrons,
} from '@ailab/domain';
import {
  type EvidenceInput,
  LabwareTypeAttributes,
  labwareExportOpentrons,
  labwareImportOpentrons,
  labwareUseStandardPositions,
  labwareWells,
  type RecordEnvelope,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { proposeIfActive } from '../operations/record-operations.ts';
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

/** Where the standard positions come from, shown as the evidence reference. */
export const SBS_POSITIONS_REFERENCE = 'ANSI/SLAS 4-2004 (R2012) Microplates: Well Positions';

const mmOf = (value: number) => ({ value: String(value), unit: 'mm' as const });

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
  implement(labwareUseStandardPositions, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { record, attributes } = await labwareTypeOf(service, ctx, input.id);
      const wells = attributes.wells;
      if (wells?.layout !== 'grid') {
        throw new OperationError(
          'invalid_input',
          `${record.name} has no grid of wells; add the rows and columns first`,
        );
      }
      if (attributes.footprint?.sbs !== true) {
        throw new OperationError(
          'invalid_input',
          `${record.name} is not marked as SBS format; the standard positions only hold for SBS labware`,
        );
      }
      const standard = sbsPositions(wells.rows, wells.columns);
      if (!standard) {
        throw new OperationError(
          'invalid_input',
          `The standard places 96, 384 and 1536 wells and 12- or 24-trough reservoirs, not ${wells.rows} × ${wells.columns}; measure the pitch and A1 offset from the datasheet drawing`,
        );
      }
      if (wells.pitch && Number(wells.pitch.value) !== standard.pitch) {
        throw new OperationError(
          'invalid_input',
          `${record.name} has a ${wells.pitch.value} mm pitch, not the standard ${standard.pitch} mm; measure the A1 offset from the datasheet drawing`,
        );
      }
      const shape = `${wells.rows} × ${wells.columns}`;
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...record.attributes,
          wells: {
            ...wells,
            pitch: mmOf(standard.pitch),
            a1: { x: mmOf(standard.a1.x), y: mmOf(standard.a1.y) },
          },
        },
        evidence: {
          wells: {
            source: 'calculated',
            reference: SBS_POSITIONS_REFERENCE,
            note: `Pitch and A1 offset are the standard for an SBS ${shape} grid; the rest of the wells is as it was. Check them against the datasheet drawing.`,
          },
        },
        reason: input.reason ?? `Standard SBS well positions for a ${shape} grid`,
      });
    },
  }),
];
