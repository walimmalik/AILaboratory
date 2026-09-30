import { generatePlateMap, PlateMapError } from '@ailab/domain';
import { type LayoutAttributes, layoutsDraft, layoutsPreview } from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';
import { layoutSpec, subjectOf } from './spec.ts';

/** Layout templates (plan 014a): drafting them and previewing what they give. */
export const plateMapOperations = [
  implement(layoutsDraft, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'layout',
        label,
        attributes,
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the layout ${label}`,
      }),
  }),
  implement(layoutsPreview, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      let a: LayoutAttributes;
      if (input.attributes) {
        if (input.layout)
          throw new OperationError('invalid_input', 'Give a saved layout or attributes, not both');
        a = input.attributes;
      } else if (input.layout) {
        const service = new RecordService(deps.db, deps.kinds);
        const record =
          input.version === undefined
            ? await service.get(ctx, input.layout)
            : (await service.history(ctx, input.layout)).find((v) => v.version === input.version)
                ?.snapshot;
        if (record?.kind !== 'layout')
          throw new OperationError(
            'not_found',
            `${input.layout}${input.version ? ` version ${input.version}` : ''} is not a layout`,
          );
        a = record.attributes as LayoutAttributes;
      } else {
        throw new OperationError('invalid_input', 'Give a saved layout or layout attributes');
      }
      const subjects = Array.from({ length: input.subjects }, (_, i) =>
        subjectOf(a, `subject_${i + 1}`, `Subject ${i + 1}`),
      );
      try {
        const result = generatePlateMap(layoutSpec(a), subjects, {
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
        });
        return { perPlate: result.perPlate, plates: result.plates.length, wells: result.plates };
      } catch (error) {
        if (error instanceof PlateMapError)
          throw new OperationError('invalid_input', error.message);
        throw error;
      }
    },
  }),
];
