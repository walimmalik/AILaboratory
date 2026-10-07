import { type RecordEnvelope, recordsOverview } from '@ailab/schema';
import { assayOverviews } from '../assays/overview.ts';
import { campaignOverviews } from '../campaigns/overview.ts';
import { entityOverviews } from '../entities/overview.ts';
import { instrumentOverviews } from '../instruments/overview.ts';
import { inventoryOverviews } from '../inventory/overview.ts';
import { labwareOverviews } from '../labware/overview.ts';
import { memoryOverviews } from '../memory/overview.ts';
import { platemapOverviews } from '../platemaps/overview.ts';
import { reagentOverviews } from '../reagents/overview.ts';
import {
  fallbackOverview,
  type OverviewBuilder,
  OverviewReader,
  words,
} from '../records/overview.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { sopOverviews } from '../sops/overview.ts';
import { implement, type OperationDeps } from './registry.ts';

/** Kind names that are not plain words. */
const NOUNS: Record<string, string> = { sop: 'SOP' };

/** Each module says how its kinds read first; kinds without a builder get the fallback. */
const builders: Record<string, OverviewBuilder> = {
  ...assayOverviews,
  ...campaignOverviews,
  ...entityOverviews,
  ...instrumentOverviews,
  ...inventoryOverviews,
  ...labwareOverviews,
  ...memoryOverviews,
  ...platemapOverviews,
  ...reagentOverviews,
  ...sopOverviews,
};

/**
 * Kinds that read well enough from the fallback for now (004f-5 adds builders as their pages are
 * designed). A new kind goes in the builders or here, on purpose; a test checks every kind does.
 */
export const FALLBACK_KINDS = new Set([
  'campaign',
  'document',
  'entity_kind',
  'equipment_item',
  'equipment_kind',
  'file',
  'liquid_class',
  'liquid_class_verification',
  'liquid_type',
  'set',
  'transfer_plan',
  'transfer_run',
  'workcell',
  'worklist_format',
]);

export const overviewKinds = () => Object.keys(builders);

/** Build an overview from this exact envelope, including historical pinned records. */
export async function buildRecordOverview(
  record: RecordEnvelope,
  ctx: RecordContext,
  deps: OperationDeps,
) {
  const build = builders[record.kind];
  return build
    ? build(record, new OverviewReader(ctx, deps))
    : fallbackOverview(record, NOUNS[record.kind] ?? words(record.kind));
}

export const overviewOperations = [
  implement(recordsOverview, {
    run: async (ctx, input, deps) => {
      const record = await new RecordService(deps.db, deps.kinds).get(ctx, input.id);
      return { id: record.id, ...(await buildRecordOverview(record, ctx, deps)) };
    },
  }),
];
