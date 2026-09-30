import { getUnit, sameDimension, scaleRecipe, UnitError } from '@ailab/domain';
import {
  type KitComponent,
  LotAttributes,
  ProductAttributes,
  type RecordEnvelope,
  reagentsDraftProduct,
  reagentsReceiveLot,
  reagentsScaleRecipe,
  reagentsSetLotStatus,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

const today = () => new Date().toISOString().slice(0, 10);

async function productOf(service: RecordService, ctx: RecordContext, id: string) {
  const record = await service.get(ctx, id);
  if (record.kind !== 'product') {
    throw new OperationError('invalid_input', `${record.name} is not a product`);
  }
  if (record.status === 'archived') {
    throw new OperationError('invalid_input', `${record.name} is archived`);
  }
  return { record, attributes: ProductAttributes.parse(record.attributes) };
}

async function lotOf(service: RecordService, ctx: RecordContext, id: string) {
  const record = await service.get(ctx, id);
  if (record.kind !== 'lot')
    throw new OperationError('invalid_input', `${record.name} is not a lot`);
  return { record, attributes: LotAttributes.parse(record.attributes) };
}

/** Refuses a product ID that isn't a product in this lab, naming it. */
async function mustBeProducts(service: RecordService, ctx: RecordContext, ids: string[]) {
  for (const id of new Set(ids)) {
    try {
      await productOf(service, ctx, id);
    } catch (error) {
      if (error instanceof RecordError && error.code === 'not_found') {
        throw new OperationError('invalid_input', `No product ${id} in this lab`);
      }
      throw error;
    }
  }
}

export const reagentOperations = [
  implement(reagentsDraftProduct, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const drafted: RecordEnvelope[] = [];
      const components: KitComponent[] = [];
      for (const component of input.components ?? []) {
        if ('draft' in component) {
          const { draft, ...amounts } = component;
          const record = await service.create(ctx, {
            kind: 'product',
            label: draft.label,
            attributes: draft.attributes,
            ...(draft.evidence ? { evidence: draft.evidence } : {}),
            reason: `Drafted as a component of ${input.label}`,
          });
          drafted.push(record);
          components.push({ product: record.id, ...amounts });
        } else {
          components.push(component);
        }
      }
      const attributes = input.attributes;
      await mustBeProducts(service, ctx, [
        ...components.map((c) => c.product),
        ...(attributes.recipe?.components ?? []).map((c) => c.product),
      ]);
      const product = await service.create(ctx, {
        kind: 'product',
        label: input.label,
        attributes: { ...attributes, ...(components.length > 0 ? { components } : {}) },
        ...(input.evidence ? { evidence: input.evidence } : {}),
        reason: input.reason ?? `Drafted ${input.label}`,
      });
      return { product, drafted };
    },
  }),
  implement(reagentsScaleRecipe, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { record, attributes } = await productOf(service, ctx, input.product);
      if (!attributes.recipe) {
        throw new OperationError('invalid_input', `${record.label} has no recipe`);
      }
      let scaled: ReturnType<typeof scaleRecipe>;
      try {
        scaled = scaleRecipe(attributes.recipe, input.target);
      } catch (error) {
        if (error instanceof UnitError) throw new OperationError('invalid_input', error.message);
        throw error;
      }
      const labels = new Map<string, string>();
      for (const c of scaled.components) {
        labels.set(c.product, (await service.get(ctx, c.product)).label);
      }
      return {
        target: input.target,
        factor: scaled.factor,
        components: scaled.components.map((c) => ({ ...c, label: labels.get(c.product) ?? '' })),
      };
    },
  }),
  implement(reagentsReceiveLot, {
    agentPolicy: 'propose',
    run: async (ctx, { evidence, reason, ...lot }, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { record: product, attributes } = await productOf(service, ctx, lot.product);
      const problems: string[] = [];

      const fields = new Map((attributes.lotFields ?? []).map((f) => [f.key, f]));
      for (const { field, value } of lot.values ?? []) {
        const known = fields.get(field);
        if (!known) {
          problems.push(
            `${product.label} has no lot field "${field}"${fields.size > 0 ? ` (it has ${[...fields.keys()].join(', ')})` : ''}`,
          );
        } else if ('unit' in value) {
          if (!getUnitSafe(value.unit)) problems.push(`"${value.unit}" is not a unit`);
          else if (known.unit && !sameDimension(value.unit, known.unit)) {
            problems.push(`${known.label} is given in ${known.unit}, not ${value.unit}`);
          }
        }
      }

      const allowed = new Set(
        attributes.origin === 'made'
          ? (attributes.recipe?.components ?? []).map((c) => c.product)
          : (attributes.components ?? []).map((c) => c.product),
      );
      for (const id of lot.componentLots ?? []) {
        const { record, attributes: component } = await lotOf(service, ctx, id);
        if (!allowed.has(component.product)) {
          problems.push(
            `${record.label} is not a lot of one of ${product.label}'s ${attributes.origin === 'made' ? 'recipe components' : 'kit components'}`,
          );
        }
      }

      const earlier = await service.list(ctx, { kind: 'lot', limit: 500 });
      if (
        earlier.some((r) => {
          const a = r.attributes as { product?: string; lotNumber?: string };
          return a.product === lot.product && a.lotNumber === lot.lotNumber;
        })
      ) {
        problems.push(`${product.label} already has lot ${lot.lotNumber}`);
      }
      if (problems.length > 0) {
        throw new OperationError(
          'invalid_input',
          `The lot can't be recorded: ${problems.join('; ')}`,
        );
      }

      return service.create(ctx, {
        kind: 'lot',
        label: `${product.label}, lot ${lot.lotNumber}`,
        status: 'active',
        attributes: { ...lot, status: 'unopened' },
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Received lot ${lot.lotNumber}`,
      });
    },
  }),
  implement(reagentsSetLotStatus, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { record, attributes } = await lotOf(service, ctx, input.id);
      if (input.date && input.status !== 'opened') {
        throw new OperationError('invalid_input', 'A date goes with status opened only');
      }
      const opened = input.status === 'opened' ? (input.date ?? today()) : attributes.opened;
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...attributes, status: input.status, ...(opened ? { opened } : {}) },
        reason: input.reason ?? `Status set to ${input.status.replaceAll('_', ' ')}`,
      });
    },
  }),
];

function getUnitSafe(code: string) {
  try {
    return getUnit(code);
  } catch {
    return undefined;
  }
}
