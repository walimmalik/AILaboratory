import {
  type ClassInfo,
  mixtureLiquidType,
  resolveClass,
  UnitError,
  verificationResult,
} from '@ailab/domain';
import {
  LiquidClassAttributes,
  LiquidTypeAttributes,
  liquidsMixtureType,
  liquidsRecordVerification,
  liquidsResolveClass,
  liquidsSearchClasses,
  ProductAttributes,
  VerificationAttributes,
} from '@ailab/schema';
import { activeMemories, lookup } from '../memory/match.ts';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

async function recordOf(service: RecordService, ctx: RecordContext, id: string, kind: string) {
  let record: Awaited<ReturnType<RecordService['get']>>;
  try {
    record = await service.get(ctx, id);
  } catch (error) {
    if (error instanceof RecordError && error.code === 'not_found') {
      throw new OperationError(
        'invalid_input',
        `No ${kind.replaceAll('_', ' ')} ${id} in this lab`,
      );
    }
    throw error;
  }
  if (record.kind !== kind || record.status === 'archived') {
    throw new OperationError(
      'invalid_input',
      `${record.name} is ${record.status === 'archived' ? 'archived' : `not a ${kind.replaceAll('_', ' ')}`}`,
    );
  }
  return record;
}

/** Each class's checks: whether one passing run isn't demo, and the latest run. */
async function classChecks(service: RecordService, ctx: RecordContext) {
  const runs = await service.list(ctx, { kind: 'liquid_class_verification', limit: 5000 });
  const verified = new Set<string>();
  const latest = new Map<string, { date: string; passed: boolean; demo: boolean }>();
  for (const run of runs) {
    const attributes = VerificationAttributes.parse(run.attributes);
    const passed = verificationResult(attributes).passed;
    if (!attributes.demo && passed) verified.add(attributes.liquidClass);
    const last = latest.get(attributes.liquidClass);
    if (!last || attributes.date > last.date) {
      latest.set(attributes.liquidClass, {
        date: attributes.date,
        passed,
        demo: attributes.demo,
      });
    }
  }
  return { verified, latest };
}

export const liquidOperations = [
  implement(liquidsResolveClass, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      let liquidType: string | undefined;
      let productOverrides: string[] | undefined;
      if ('product' in input.liquid) {
        const product = await recordOf(service, ctx, input.liquid.product, 'product');
        const attributes = ProductAttributes.parse(product.attributes);
        liquidType = attributes.liquidType;
        productOverrides = attributes.liquidClasses;
      } else {
        liquidType = input.liquid.liquidType;
      }
      const liquidTypeLabel = liquidType
        ? (await recordOf(service, ctx, liquidType, 'liquid_type')).label
        : undefined;
      const { verified } = await classChecks(service, ctx);
      const classes: ClassInfo[] = (
        await service.list(ctx, { kind: 'liquid_class', limit: 5000 })
      ).map((r) => ({
        id: r.id,
        label: `${r.label} (${r.name})`,
        attributes: LiquidClassAttributes.parse(r.attributes),
        active: r.status === 'active',
        verified: verified.has(r.id),
      }));
      // Lab memory may prefer or avoid a class for this work (plan 005b).
      const { effects } = lookup(await activeMemories(deps, ctx), ctx, {
        records: [
          input.instrumentKind,
          ...(liquidType ? [liquidType] : []),
          ...(input.device ? [input.device] : []),
          ...classes.map((c) => c.id),
        ],
        facts: {
          instrumentKind: input.instrumentKind,
          ...(input.device ? { device: input.device } : {}),
          ...(input.tip ? { tip: input.tip } : {}),
          ...(input.sourceLabware ? { labware: [input.sourceLabware] } : {}),
          ...(input.mode ? { mode: input.mode } : {}),
          volume: input.volume,
          ...(liquidType ? { liquidType } : {}),
        },
      });
      return resolveClass(
        {
          memory: effects,
          instrumentKind: input.instrumentKind,
          device: input.device,
          tip: input.tip,
          sourceLabware: input.sourceLabware,
          mode: input.mode,
          volume: input.volume,
          liquidType,
          liquidTypeLabel,
          explicit: input.liquidClass,
          productOverrides,
        },
        classes,
      );
    },
  }),
  implement(liquidsMixtureType, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const types = new Map<string, { label: string; base: LiquidTypeAttributes['base'] }>();
      for (const part of input.parts) {
        if (types.has(part.liquidType)) continue;
        const record = await recordOf(service, ctx, part.liquidType, 'liquid_type');
        types.set(part.liquidType, {
          label: record.label,
          base: LiquidTypeAttributes.parse(record.attributes).base,
        });
      }
      try {
        const mixture = mixtureLiquidType(
          input.parts.map((p) => ({
            liquidType: p.liquidType,
            base: types.get(p.liquidType)?.base ?? 'aqueous',
            volume: p.volume,
          })),
        );
        return {
          liquidType: mixture.liquidType,
          label: types.get(mixture.liquidType)?.label ?? '',
          shares: mixture.shares,
          why: mixture.why,
        };
      } catch (error) {
        if (error instanceof UnitError) throw new OperationError('invalid_input', error.message);
        if (error instanceof Error) throw new OperationError('invalid_input', error.message);
        throw error;
      }
    },
  }),
  implement(liquidsRecordVerification, {
    agentPolicy: 'propose',
    run: async (ctx, { reason, ...attributes }, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const liquidClass = await recordOf(service, ctx, attributes.liquidClass, 'liquid_class');
      if (attributes.instrument) await recordOf(service, ctx, attributes.instrument, 'instrument');
      let result: ReturnType<typeof verificationResult>;
      try {
        result = verificationResult(attributes);
      } catch (error) {
        if (error instanceof Error) throw new OperationError('invalid_input', error.message);
        throw error;
      }
      const record = await service.create(ctx, {
        kind: 'liquid_class_verification',
        label: `${liquidClass.label}, ${attributes.method} check ${attributes.date}${attributes.demo ? ' (demo)' : ''}`,
        status: 'active',
        attributes,
        reason: reason ?? result.why,
      });
      return { record, result };
    },
  }),
  implement(liquidsSearchClasses, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const { verified, latest } = await classChecks(service, ctx);
      const status = input.status ? { status: input.status } : {};
      const text = input.text?.trim().toLowerCase();
      const matches = (
        await service.list(ctx, { kind: 'liquid_class', ...status, limit: 5000 })
      ).flatMap((record) => {
        const a = LiquidClassAttributes.parse(record.attributes);
        const isVerified = verified.has(record.id);
        const found =
          (!text ||
            [record.label, record.name, a.platformName].some((v) =>
              v?.toLowerCase().includes(text),
            )) &&
          (!input.instrumentKind || a.instrumentKind === input.instrumentKind) &&
          (!input.device || a.device === input.device) &&
          (!input.tip || (a.tips ?? []).includes(input.tip)) &&
          (!input.liquidType || a.liquidTypes.includes(input.liquidType)) &&
          (!input.platform || a.settings.platform === input.platform) &&
          (input.verified === undefined || isVerified === input.verified);
        const lastCheck = latest.get(record.id);
        return found
          ? [{ liquidClass: record, verified: isVerified, ...(lastCheck ? { lastCheck } : {}) }]
          : [];
      });
      return { classes: matches.slice(0, input.limit ?? 200), total: matches.length };
    },
  }),
];
