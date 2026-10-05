import {
  generatePlateMap,
  PlateMapError,
  parseRegion,
  plateFormat,
  sortWells,
} from '@ailab/domain';
import {
  type FixedRegion,
  type LayoutAttributes,
  layoutsDraft,
  layoutsPreview,
  layoutsSaveFromMap,
  type PlateMapAttributes,
  platemapsDraft,
  platemapsExport,
  platemapsOverride,
  platemapsWells,
  type RecordEnvelope,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { type AgentPolicy, implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { planPlateMap } from './generate.ts';
import { layoutSpec, subjectOf } from './spec.ts';

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

/** A record as it is now, or at a version; refused when it isn't of the kind. */
async function recordAt(
  records: RecordService,
  ctx: RecordContext,
  id: string,
  kind: string,
  noun: string,
  version?: number,
): Promise<RecordEnvelope> {
  const record =
    version === undefined
      ? await records.get(ctx, id).catch(() => undefined)
      : (await records.history(ctx, id).catch(() => [])).find((v) => v.version === version)
          ?.snapshot;
  if (record?.kind !== kind)
    throw new OperationError(
      'not_found',
      `${id}${version ? ` version ${version}` : ''} is not ${noun} in this lab`,
    );
  return record;
}

/** A plate map worked out at a version, with its pinned layout. */
async function wellsOf(
  deps: Pick<OperationDeps, 'db' | 'kinds'>,
  ctx: RecordContext,
  id: string,
  version?: number,
) {
  const records = service(deps);
  const map = await recordAt(records, ctx, id, 'plate_map', 'a plate map', version);
  const a = map.attributes as PlateMapAttributes;
  const layout = await recordAt(records, ctx, a.layout.id, 'layout', 'a layout', a.layout.version);
  const get = (rid: string) => records.get(ctx, rid).catch(() => undefined);
  try {
    return { map, result: await planPlateMap(a, layout.attributes as LayoutAttributes, get) };
  } catch (error) {
    if (error instanceof PlateMapError) throw new OperationError('invalid_state', error.message);
    throw error;
  }
}

/** Agents edit a draft plate map directly; changes to a confirmed one are proposals. */
const draftOnly: AgentPolicy<{ id: string }> = async (ctx, input, deps) =>
  (await service(deps).get(ctx, input.id)).status === 'draft' ? 'direct' : 'propose';

/** Roles that name what a well is for rather than which sample goes in it. */
const SUBJECT_ROLES = ['sample', 'compound'];

/**
 * A layout from a plate map (P3): the pinned layout with the map's strategy, and plate 1's hand
 * edits that change what a well is for as fixed regions. Wells they take leave the regions that
 * held them, written out well by well.
 */
export function layoutFromMap(
  layout: LayoutAttributes,
  map: PlateMapAttributes,
  source: string,
): { attributes: LayoutAttributes; kept: number; left: number } {
  const format = plateFormat(layout.wells);
  const edits = (map.overrides ?? []).filter(
    (o) => o.plate === 1 && !SUBJECT_ROLES.includes(o.role),
  );
  const taken = new Set(edits.map((o) => o.well));
  const without = (region: string[]) => {
    const wells = region.flatMap((r) => parseRegion(r, format));
    const kept = wells.filter((w) => !taken.has(w));
    return kept.length === wells.length ? region : sortWells(kept, layout.fillOrder ?? 'row');
  };
  const fixed: FixedRegion[] = [];
  for (const f of layout.fixed ?? []) {
    const region = without(f.region);
    if (region.length) fixed.push({ ...f, region });
  }
  const groups = new Map<string, typeof edits>();
  for (const o of edits) {
    const key = [o.role, o.label ?? '', o.subject ?? ''].join('|');
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  let n = 0;
  for (const group of groups.values()) {
    const first = group[0] as (typeof edits)[number];
    n += 1;
    fixed.push({
      id: `edit_${n}`,
      role: first.role,
      ...(first.label ? { label: first.label } : {}),
      region: sortWells(
        group.map((o) => o.well),
        layout.fillOrder ?? 'row',
      ),
      ...(first.subject ? { subject: first.subject } : {}),
    });
  }
  const { subjectRegion, strategy, notes: _notes, ...rest } = layout;
  const region = subjectRegion ? without(subjectRegion) : undefined;
  const left = (map.overrides ?? []).length - edits.length;
  return {
    attributes: {
      ...rest,
      ...(region ? { subjectRegion: region } : {}),
      ...(fixed.length ? { fixed } : {}),
      ...((map.strategy ?? strategy) ? { strategy: map.strategy ?? strategy } : {}),
      notes: `Saved from ${source}${edits.length ? ` with ${edits.length} hand edit${edits.length === 1 ? '' : 's'} as regions` : ''}`,
    },
    kept: edits.length,
    left,
  };
}

const csvCell = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Layout templates and plate maps (plan 014a). */
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
      // Named for what the layout holds ("Sample 14"), as the plate map names its own.
      const noun =
        a.subjectRole.charAt(0).toUpperCase() + a.subjectRole.slice(1).replaceAll('_', ' ');
      const subjects = Array.from({ length: input.subjects }, (_, i) =>
        subjectOf(a, `subject_${i + 1}`, `${noun} ${i + 1}`),
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
  implement(platemapsDraft, {
    agentPolicy: 'direct',
    run: async (ctx, { label, layout, layoutVersion, seed, evidence, reason, ...rest }, deps) => {
      const records = service(deps);
      const current = await recordAt(records, ctx, layout, 'layout', 'a layout');
      const version = layoutVersion ?? current.version;
      const pinned = await recordAt(records, ctx, layout, 'layout', 'a layout', version);
      const strategy =
        rest.strategy ?? (pinned.attributes as LayoutAttributes).strategy ?? 'in_order';
      const chosen =
        seed ?? (strategy === 'in_order' ? undefined : Math.floor(Math.random() * 2 ** 31));
      return records.create(ctx, {
        kind: 'plate_map',
        label,
        attributes: {
          layout: { id: layout, version },
          ...rest,
          ...(chosen !== undefined ? { seed: chosen } : {}),
        } satisfies PlateMapAttributes,
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the plate map ${label} from ${current.name}`,
      });
    },
  }),
  implement(platemapsWells, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const { result } = await wellsOf(deps, ctx, input.id, input.version);
      return result as never;
    },
  }),
  implement(platemapsOverride, {
    agentPolicy: draftOnly,
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const map = await recordAt(records, ctx, input.id, 'plate_map', 'a plate map');
      const a = map.attributes as PlateMapAttributes;
      if (!input.overrides?.length && !input.clear?.length)
        throw new OperationError('invalid_input', 'Give wells to change or hand edits to clear');
      const key = (o: { plate: number; well: string }) => `${o.plate}:${o.well}`;
      const drop = new Set([...(input.clear ?? []), ...(input.overrides ?? [])].map(key));
      const unknown = (input.clear ?? []).filter(
        (c) => !(a.overrides ?? []).some((o) => key(o) === key(c)),
      );
      if (unknown.length)
        throw new OperationError(
          'invalid_input',
          `No hand edit on ${unknown.map((c) => `plate ${c.plate} ${c.well}`).join(', ')}`,
        );
      const overrides = [
        ...(a.overrides ?? []).filter((o) => !drop.has(key(o))),
        ...(input.overrides ?? []),
      ];
      const { overrides: _o, ...rest } = a;
      const n = input.overrides?.length ?? 0;
      return records.update(ctx, map.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...rest, ...(overrides.length ? { overrides } : {}) },
        reason:
          input.reason ??
          (n
            ? `Changed ${n} well${n === 1 ? '' : 's'} by hand`
            : `Cleared ${input.clear?.length} hand edit${input.clear?.length === 1 ? '' : 's'}`),
      });
    },
  }),
  implement(platemapsExport, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const { map, result } = await wellsOf(deps, ctx, input.id, input.version);
      const lines = [
        'plate,well,role,subject,name,replicate,point,concentration,unit',
        ...result.plates.flatMap((p) =>
          p.wells.map((w) =>
            [
              p.plate,
              w.well,
              w.role,
              w.subject,
              w.label,
              w.replicate,
              w.point,
              w.concentration?.value,
              w.concentration?.unit,
            ]
              .map(csvCell)
              .join(','),
          ),
        ),
      ];
      return { filename: `${map.name}.csv`, csv: `${lines.join('\n')}\n` };
    },
  }),
  implement(layoutsSaveFromMap, {
    agentPolicy: 'direct',
    touches: (input, output) => [input.map, ...(output ? [output.id] : [])],
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const map = await recordAt(records, ctx, input.map, 'plate_map', 'a plate map');
      const a = map.attributes as PlateMapAttributes;
      const layout = await recordAt(
        records,
        ctx,
        a.layout.id,
        'layout',
        'a layout',
        a.layout.version,
      );
      const { attributes, left } = layoutFromMap(
        layout.attributes as LayoutAttributes,
        a,
        `${map.name} (${layout.name} v${a.layout.version})`,
      );
      return records.create(ctx, {
        kind: 'layout',
        label: input.label,
        attributes,
        reason:
          input.reason ??
          `Saved ${map.name} as a layout${left ? `; ${left} hand edit${left === 1 ? '' : 's'} naming samples or on later plates left out` : ''}`,
      });
    },
  }),
];
