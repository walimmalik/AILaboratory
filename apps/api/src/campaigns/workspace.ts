import {
  type ExperimentAttributes,
  experimentsWorkspace,
  type PlateMapAttributes,
  platemapsWells,
  type RecordEnvelope,
  type TransferGroup,
  type TransferPlanAttributes,
  type WorkspaceProjection,
  type WorkspaceRecordSummary,
  workspaceHref,
} from '@ailab/schema';
import type { z } from 'zod';
import { OperationError } from '../operations/errors.ts';
import { buildRecordOverview } from '../operations/overview.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

type Input = z.infer<typeof experimentsWorkspace.input>;
type Related = Extract<WorkspaceProjection, { panel: 'design' }>['related']['items'][number];
type Ref = { id: string; version?: number; relation: Related['relation'] };
type Page = { offset: number; limit: number };
const defaults = { offset: 0, limit: 20 };
export function workspacePage<T>(items: T[], request: Page = defaults) {
  const selected = items.slice(request.offset, request.offset + request.limit);
  return {
    items: selected,
    ...request,
    total: items.length,
    hasMore: request.offset + selected.length < items.length,
  };
}
const summary = (r: RecordEnvelope): WorkspaceRecordSummary => ({
  id: r.id,
  version: r.version,
  kind: r.kind,
  name: r.name,
  label: r.label,
  status: r.status,
  ...(r.summary === undefined ? {} : { summary: r.summary }),
  ...(r.readiness === undefined ? {} : { readiness: r.readiness }),
});
const compare = (a: RecordEnvelope, b: RecordEnvelope) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const groupSummary = ({ transfers, alternatives: _alternatives, ...group }: TransferGroup) => ({
  ...group,
  transferCount: transfers.length,
});

/** Direct references only: never expand a set, SOP defaults, or inventory. */
function experimentRefs(a: ExperimentAttributes): Ref[] {
  return [
    { id: a.campaign, relation: 'campaign' },
    ...(a.subjects ?? []).map((s) => ({ id: s.record, relation: 'subject' as const })),
    ...(a.template ? [{ ...a.template, relation: 'template' as const }] : []),
    ...a.protocol.flatMap((p) => [
      { ...p.sop, relation: 'protocol' as const },
      ...(p.bindings ?? []).map((b) => ({
        id: b.record,
        ...(b.version === undefined ? {} : { version: b.version }),
        relation: 'binding' as const,
      })),
    ]),
    ...(a.documents ?? []).map((d) => ({ id: d.document, relation: 'document' as const })),
  ];
}

/** Workspace projection and assistant grounding share this resolver. All loads use record scope. */
export async function resolveWorkspace(
  deps: OperationDeps,
  ctx: RecordContext,
  input: Input,
): Promise<WorkspaceProjection> {
  const service = new RecordService(deps.db, deps.kinds);
  const cached = new Map<string, RecordEnvelope>();
  const pinned = new Map<string, RecordEnvelope>();
  const exactAt = async (id: string, version: number) => {
    const key = `${id}:${version}`;
    const existing = pinned.get(key);
    if (existing) return existing;
    const snapshot = (await service.getVersion(ctx, id, version)).snapshot;
    pinned.set(key, snapshot);
    return snapshot;
  };
  const prime = async (ids: string[]) => {
    const unique = [...new Set(ids)].filter((id) => !cached.has(id));
    if (!unique.length) return;
    for (const r of await service.list(ctx, { ids: unique })) {
      if (r.orgId === ctx.orgId && r.labId === ctx.labId) cached.set(r.id, r);
    }
    for (const id of unique)
      if (!cached.has(id))
        throw new OperationError('not_found', `No selected record ${id} in this lab`);
  };
  const get = async (id: string) => {
    await prime([id]);
    const record = cached.get(id);
    if (!record)
      throw new OperationError('not_found', 'The selected record is unavailable in this lab.');
    return record;
  };
  const currentSelected = async (id: string, version: number, kind: string) => {
    const r = await get(id);
    if (r.kind !== kind) throw new OperationError('not_found', `No selected ${kind} in this lab`);
    if (r.version !== version)
      throw new OperationError(
        'version_conflict',
        'The selected record changed. Refresh the view before continuing.',
      );
    if (r.status === 'archived')
      throw new OperationError(
        'invalid_input',
        'The selected record is archived. Choose an available record.',
      );
    if ((r.attributes as { experiment?: string }).experiment !== input.id)
      throw new OperationError(
        'invalid_input',
        `The selected ${kind === 'plate_map' ? 'map' : 'plan'} belongs to another experiment.`,
      );
    return r;
  };
  const experiment = await get(input.id);
  if (experiment.kind !== 'experiment')
    throw new OperationError('not_found', 'No experiment in this lab');
  if (input.expectedVersion !== undefined && input.expectedVersion !== experiment.version)
    throw new OperationError(
      'version_conflict',
      'The experiment changed. Refresh the workspace before continuing.',
    );
  const a = experiment.attributes as ExperimentAttributes;
  const campaign = await get(a.campaign);
  if (campaign.kind !== 'campaign')
    throw new OperationError('invalid_state', 'The experiment has no valid campaign.');
  const view = input.view;
  const selection = { experiment: experiment.id, version: experiment.version, view };
  const header = {
    experiment: {
      ...summary(experiment),
      question: a.question,
      stage: a.stage,
      subjectCount: a.subjects?.length ?? 0,
    },
    campaign: summary(campaign),
    selection,
    href: workspaceHref(selection),
  };
  let refs = experimentRefs(a);
  let projection: WorkspaceProjection;
  // Use the complete reverse-link membership, not a default-limited registry list.
  const members = async (kind: string) => {
    const ids = [...new Set((await service.linksTo(ctx, experiment.id)).map((l) => l.fromId))];
    await prime(ids);
    return (await Promise.all(ids.map(get)))
      .filter(
        (r) =>
          r.kind === kind &&
          r.status !== 'archived' &&
          (r.attributes as { experiment?: string }).experiment === experiment.id,
      )
      .sort(compare);
  };
  const related = async (references: Ref[]): Promise<Related[]> => {
    await prime(references.map((r) => r.id));
    const out = new Map<string, Related>();
    for (const ref of references) {
      const r = ref.version === undefined ? await get(ref.id) : await exactAt(ref.id, ref.version);
      const entry = {
        record: summary(r),
        relation: ref.relation,
        pinned: ref.version !== undefined,
      };
      const key = `${entry.relation}:${r.id}:${r.version}`;
      // If a relationship is both live and pinned to the same version, retain the explicit pin.
      if (!out.has(key) || entry.pinned) out.set(key, entry);
    }
    return [...out.values()].sort(
      (x, y) =>
        x.relation.localeCompare(y.relation) ||
        x.record.name.localeCompare(y.record.name) ||
        x.record.id.localeCompare(y.record.id) ||
        x.record.version - y.record.version,
    );
  };
  if (view.panel === 'design') {
    projection = {
      ...header,
      panel: 'design',
      related: workspacePage(await related(refs), view.page),
    };
  } else if (view.panel === 'plates') {
    projection = {
      ...header,
      panel: 'plates',
      maps: workspacePage((await members('plate_map')).map(summary), view.page),
    };
    if (view.map) {
      const map = await currentSelected(view.map.id, view.map.version, 'plate_map');
      const ma = map.attributes as PlateMapAttributes;
      const result = await deps.registry.execute(
        ctx,
        platemapsWells.id,
        { id: map.id, version: map.version },
        {},
        deps.db,
      );
      if (result.status !== 'done')
        throw new OperationError('internal', 'The selected plate map could not be read.');
      const generated = platemapsWells.output.parse(result.output);
      const plate = generated.plates.find((p) => p.plate === view.map?.plate);
      if (!plate)
        throw new OperationError('invalid_input', 'The selected map plate does not exist.');
      if (view.map.wells?.some((well) => !plate.wells.some((w) => w.well === well)))
        throw new OperationError('invalid_input', 'A selected well does not exist on this plate.');
      const layout = await exactAt(ma.layout.id, ma.layout.version);
      const fixed = (layout.attributes as { fixed?: { subject?: string }[] }).fixed ?? [];
      const selectedRefs: Ref[] = [
        { ...ma.layout, relation: 'layout' },
        ...(ma.labware ? [{ ...ma.labware, relation: 'labware' as const }] : []),
        ...(ma.controls ?? []).map((c) => ({ id: c.record, relation: 'control' as const })),
        ...fixed.flatMap((c) =>
          c.subject ? [{ id: c.subject, relation: 'control' as const }] : [],
        ),
        ...plate.wells.flatMap((w) =>
          w.subject ? [{ id: w.subject, relation: 'subject' as const }] : [],
        ),
      ];
      refs = [...refs, ...selectedRefs];
      projection.selectedMap = {
        record: summary(map),
        plateCount: generated.plates.length,
        plate: view.map.plate,
        wells: plate.wells,
        related: workspacePage(await related(selectedRefs), view.map.relatedPage),
      };
    }
  } else {
    projection = {
      ...header,
      panel: 'transfers',
      plans: workspacePage((await members('transfer_plan')).map(summary), view.page),
    };
    if (view.plan) {
      const plan = await currentSelected(view.plan.id, view.plan.version, 'transfer_plan');
      const pa = plan.attributes as TransferPlanAttributes;
      const group =
        view.plan.group === undefined
          ? undefined
          : pa.groups.find((g) => g.id === view.plan?.group);
      if (view.plan.group && !group)
        throw new OperationError('invalid_input', 'The selected plan group does not exist.');
      const selectedRefs: Ref[] = [
        ...pa.plates.flatMap((p) => [
          { ...p.labwareType, relation: 'labware' as const },
          ...(p.container ? [{ id: p.container, relation: 'container' as const }] : []),
        ]),
        ...(group ? [group] : pa.groups).flatMap((g) => [
          ...(g.instrument
            ? [{ id: g.instrument.instrument, relation: 'instrument' as const }]
            : []),
          ...(g.liquid ? [{ id: g.liquid, relation: 'liquid' as const }] : []),
          ...(g.liquidClass ? [{ id: g.liquidClass, relation: 'liquid_class' as const }] : []),
          ...(g.worklist ? [{ ...g.worklist, relation: 'worklist' as const }] : []),
        ]),
      ];
      refs = [...refs, ...selectedRefs];
      projection.selectedPlan = {
        record: summary(plan),
        related: workspacePage(await related(selectedRefs), view.plan.relatedPage),
        groups: workspacePage(pa.groups.map(groupSummary), view.plan.groupsPage),
      };
      if (group) {
        const rows = workspacePage(
          group.transfers.map((transfer, index) => ({ transfer, index })),
          view.plan.rowsPage,
        );
        projection.selectedPlan.selectedGroup = {
          group: groupSummary(group),
          rows: {
            ...rows,
            items: rows.items.map((row) => {
              const source = pa.plates.find((p) => p.id === row.transfer.from.plate);
              const destination = pa.plates.find((p) => p.id === row.transfer.to.plate);
              if (!source || !destination)
                throw new OperationError(
                  'invalid_state',
                  'The saved transfer refers to an unknown source or destination.',
                );
              return { ...row, source, destination };
            }),
          },
        };
      }
    }
  }
  // Resolve the complete direct reference set even when its visible page is empty.
  const scope = await related(refs);
  if (view.detail) {
    const current = await get(view.detail.id); // Foreign records refuse without leaking their metadata.
    const candidates = scope.filter((r) => r.record.id === current.id);
    if (!candidates.length)
      throw new OperationError(
        'invalid_input',
        'The selected detail is not directly referenced in this experiment view.',
      );
    const chosen = candidates.find((r) => r.record.version === view.detail?.version);
    if (!chosen) {
      if (candidates.some((r) => !r.pinned))
        throw new OperationError(
          'version_conflict',
          'The selected detail changed. Refresh it before continuing.',
        );
      throw new OperationError(
        'invalid_input',
        'The selected detail version does not match its pinned reference.',
      );
    }
    const exact = chosen.pinned ? await exactAt(current.id, chosen.record.version) : current;
    const overview = await buildRecordOverview(exact, ctx, deps);
    projection.detail = {
      ...chosen,
      overview: {
        identity: overview.identity.slice(0, 12),
        facts: overview.facts.slice(0, 50).map((f) => ({
          ...f,
          ...(f.field && exact.evidence[f.field] ? { evidence: exact.evidence[f.field] } : {}),
        })),
        omittedIdentityParts: Math.max(0, overview.identity.length - 12),
        omittedFacts: Math.max(0, overview.facts.length - 50),
        relatedRecords: 'current',
      },
    };
  }
  return projection;
}

export const workspaceOperations = [
  implement(experimentsWorkspace, {
    run: (ctx, input, deps) => resolveWorkspace(deps, ctx, input),
  }),
];
