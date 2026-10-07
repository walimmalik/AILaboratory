import { z } from 'zod';
import { ExperimentId, ExperimentStage } from './campaigns.ts';
import { FieldEvidence, pinOf, ReadinessSummary } from './design.ts';
import { RecordId, RecordName } from './ids.ts';
import { LocalId } from './instruments.ts';
import { WellName } from './labware.ts';
import { OverviewFact, OverviewPart } from './overview.ts';
import { PlateMapId, WellPlan } from './platemaps.ts';
import { RecordStatus } from './record.ts';
import { PlannedTransfer, PlanPlate, TransferGroup, TransferPlanId } from './transfers.ts';

/** W1 is a read projection. These are presentation selectors, never scientific state. */
export const WorkspacePageRequest = z.strictObject({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(50),
});
export const WorkspaceRecordPin = pinOf(RecordId);
const common = {
  page: WorkspacePageRequest.optional().describe('Main list; default offset 0, limit 20'),
  detail: WorkspaceRecordPin.optional().describe(
    'A directly referenced record at its pinned version, or current version for an unpinned reference; never an arbitrary lab record',
  ),
};
export const WorkspaceView = z.discriminatedUnion('panel', [
  z.strictObject({ panel: z.literal('design'), ...common }),
  z.strictObject({
    panel: z.literal('plates'),
    ...common,
    map: z
      .strictObject({
        id: PlateMapId,
        version: z.number().int().positive(),
        plate: z.number().int().positive(),
        relatedPage: WorkspacePageRequest.optional(),
        wells: z
          .array(WellName)
          .min(1)
          .max(64)
          .refine((wells) => new Set(wells).size === wells.length, {
            message: 'Select each well once',
          })
          .optional(),
      })
      .optional(),
  }),
  z.strictObject({
    panel: z.literal('transfers'),
    ...common,
    plan: z
      .strictObject({
        id: TransferPlanId,
        version: z.number().int().positive(),
        group: LocalId.optional(),
        groupsPage: WorkspacePageRequest.optional(),
        relatedPage: WorkspacePageRequest.optional(),
        rowsPage: WorkspacePageRequest.optional(),
      })
      .refine((plan) => !plan.rowsPage || Boolean(plan.group), {
        message: 'Transfer rows need a selected group',
      })
      .optional(),
  }),
]);
export type WorkspaceView = z.infer<typeof WorkspaceView>;

/** Supplied versions are optimistic concurrency checks, not requests for historical workspaces. */
export const WorkspaceSelection = z.strictObject({
  experiment: ExperimentId,
  version: z.number().int().positive(),
  view: WorkspaceView,
});
export type WorkspaceSelection = z.infer<typeof WorkspaceSelection>;

/** A bounded named reference. No raw attributes, members, protocol steps or transfer arrays. */
export const WorkspaceRecordSummary = z.strictObject({
  id: RecordId,
  version: z.number().int().positive(),
  kind: z.string(),
  name: RecordName,
  label: z.string(),
  status: RecordStatus,
  summary: z.string().optional(),
  readiness: ReadinessSummary.optional(),
});
export type WorkspaceRecordSummary = z.infer<typeof WorkspaceRecordSummary>;

export function workspacePage<T extends z.ZodType>(item: T) {
  return z.strictObject({
    items: z.array(item).max(50),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(50),
    total: z
      .number()
      .int()
      .nonnegative()
      .describe('Exact count of this collection in the scoped read, not returned length'),
    hasMore: z.boolean().describe('offset + items.length < total'),
  });
}

export const WorkspaceRelatedRecord = z.strictObject({
  record: WorkspaceRecordSummary,
  relation: z.enum([
    'campaign',
    'subject',
    'template',
    'protocol',
    'binding',
    'document',
    'layout',
    'labware',
    'control',
    'container',
    'instrument',
    'liquid',
    'liquid_class',
    'worklist',
  ]),
  pinned: z.boolean().describe('True when this relationship explicitly pins this version'),
});
/** Existing kind-owned overview, built from the exact selected envelope, not a latest-ID lookup. */
export const WorkspaceDetail = WorkspaceRelatedRecord.extend({
  overview: z.strictObject({
    identity: z.array(OverviewPart).max(12),
    facts: z
      .array(
        OverviewFact.extend({
          evidence: FieldEvidence.optional().describe(
            'Evidence for the fact field on the exact selected record; absent is unknown, not verified',
          ),
        }),
      )
      .max(50),
    omittedIdentityParts: z.number().int().nonnegative(),
    omittedFacts: z
      .number()
      .int()
      .nonnegative()
      .describe('Any omitted facts remain accessible via Open full record'),
    relatedRecords: z
      .literal('current')
      .describe(
        'Secondary names, locations and inventory facts use current lab records; this is not a historical stock snapshot',
      ),
  }),
});
export const WorkspaceGroupSummary = TransferGroup.omit({
  transfers: true,
  alternatives: true,
}).extend({
  transferCount: z.number().int().nonnegative(),
});

const header = {
  experiment: WorkspaceRecordSummary.extend({
    id: ExperimentId,
    question: z.string(),
    stage: ExperimentStage,
    subjectCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Direct subject entries; does not expand set membership'),
  }),
  campaign: WorkspaceRecordSummary,
  selection: WorkspaceSelection.describe(
    'Validated selection; same contract for browser and headless callers',
  ),
  href: z
    .string()
    .startsWith('/records/')
    .max(8000)
    .describe('Relative app URL restoring this exact validated selection'),
  detail: WorkspaceDetail.optional().describe(
    'Only the explicitly selected related record, with bounded module-owned overview facts',
  ),
};

export const WorkspaceProjection = z.discriminatedUnion('panel', [
  z.strictObject({
    ...header,
    panel: z.literal('design'),
    related: workspacePage(WorkspaceRelatedRecord),
  }),
  z.strictObject({
    ...header,
    panel: z.literal('plates'),
    maps: workspacePage(WorkspaceRecordSummary.extend({ id: PlateMapId })),
    selectedMap: z
      .strictObject({
        record: WorkspaceRecordSummary.extend({ id: PlateMapId }),
        related: workspacePage(WorkspaceRelatedRecord),
        plateCount: z.number().int().nonnegative(),
        plate: z.number().int().positive(),
        wells: z
          .array(WellPlan)
          .max(1536)
          .describe('Only the selected plate, never every plate in the map'),
      })
      .optional(),
  }),
  z.strictObject({
    ...header,
    panel: z.literal('transfers'),
    plans: workspacePage(WorkspaceRecordSummary.extend({ id: TransferPlanId })),
    selectedPlan: z
      .strictObject({
        record: WorkspaceRecordSummary.extend({ id: TransferPlanId }),
        related: workspacePage(WorkspaceRelatedRecord),
        groups: workspacePage(WorkspaceGroupSummary),
        selectedGroup: z
          .strictObject({
            group: WorkspaceGroupSummary,
            rows: workspacePage(
              z.strictObject({
                index: z
                  .number()
                  .int()
                  .nonnegative()
                  .describe('Zero-based index in the persisted group'),
                transfer: PlannedTransfer,
                source: PlanPlate,
                destination: PlanPlate,
              }),
            ),
          })
          .optional(),
      })
      .optional(),
  }),
]);
export type WorkspaceProjection = z.infer<typeof WorkspaceProjection>;
