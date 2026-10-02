import {
  type Condition,
  DesignError,
  type DesignTotals,
  designConditions,
  designTotals,
  formatQuantity,
  type Level,
  type ResolvedFactor,
  seriesLevels,
} from '@ailab/domain';
import {
  type AssayTemplateAttributes,
  assaysDesign,
  assaysDraftTemplate,
  assaysSaveFromExperiment,
  assaysSearch,
  DecimalString,
  type EvidenceInput,
  type ExperimentAttributes,
  type LayoutAttributes,
  type Quantity,
  type RecordEnvelope,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

/**
 * Assay templates (plan 017a, ADR 0065): drafting one, working out what it gives for a request
 * (missing inputs, conditions, wells and plates), saving a confirmed experiment as one, and finding
 * the lab's templates. Updating and
 * confirming are `records.update` and `records.confirm`, as for any design.
 */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

const isQuantity = (v: unknown): v is Quantity =>
  !!v && typeof v === 'object' && 'value' in v && 'unit' in v;

/** A record as it was at a version, or as it is now. */
export async function recordAt(
  deps: OperationDeps,
  ctx: RecordContext,
  id: string,
  version: number | undefined,
) {
  const records = service(deps);
  if (version === undefined) return records.get(ctx, id).catch(() => undefined);
  return (await records.history(ctx, id).catch(() => [])).find((v) => v.version === version)
    ?.snapshot;
}

export type Answers = Record<string, number | string[] | Quantity | string>;

export interface WorkedOut {
  missing: { id: string; label: string }[];
  /** Empty while a factor waits for its input. */
  conditions: Condition[];
  totals?: Omit<DesignTotals, 'lines'>;
  lines: string[];
  /** The records given for each subjects input, in order. */
  subjects: Map<string, RecordEnvelope[]>;
  /** Each factor with its levels, once its input is given. */
  factors: ResolvedFactor[];
}

/**
 * What a template gives for the answers so far (plan 017a, D3, D5, D6): checks the answers, lists
 * the essential inputs still open, combines the factors into conditions and works out the totals.
 */
export async function workOut(
  deps: OperationDeps,
  ctx: RecordContext,
  a: AssayTemplateAttributes,
  answers: Answers,
  wellsPerPlate: number | undefined,
): Promise<WorkedOut> {
  const essentials = new Map(a.essentials.map((e) => [e.id, e]));
  const records = service(deps);
  const subjects = new Map<string, RecordEnvelope[]>();
  for (const [id, answer] of Object.entries(answers)) {
    const e = essentials.get(id);
    if (!e) throw new OperationError('invalid_input', `The template asks for no input ${id}`);
    if (e.input === 'subjects') {
      if (typeof answer !== 'number' && !Array.isArray(answer))
        throw new OperationError('invalid_input', `${e.label}: give a count or the records`);
      const n = typeof answer === 'number' ? answer : answer.length;
      if (e.max && n > e.max)
        throw new OperationError('invalid_input', `${e.label}: at most ${e.max}`);
      if (Array.isArray(answer)) {
        const found: RecordEnvelope[] = [];
        for (const rid of answer) {
          const record = await records.get(ctx, rid).catch(() => undefined);
          if (!record)
            throw new OperationError('invalid_input', `${rid} is not a record in this lab`);
          if (e.kinds && !e.kinds.includes(record.kind))
            throw new OperationError(
              'invalid_input',
              `${e.label}: ${record.name} is a ${record.kind.replaceAll('_', ' ')}, not ${e.kinds.map((k) => `a ${k.replaceAll('_', ' ')}`).join(' or ')}`,
            );
          found.push(record);
        }
        subjects.set(id, found);
      }
    } else if (Array.isArray(answer))
      throw new OperationError('invalid_input', `${e.label}: give a value, not records`);
    else if (typeof answer === 'string' && !DecimalString.safeParse(answer).success) {
      // Said by the input's own label, so a person sees which answer to change (review #19).
      const ratio = /^\s*\d+(\.\d+)?\s*:\s*(\d+(\.\d+)?)\s*$/.exec(answer);
      throw new OperationError(
        'invalid_input',
        ratio
          ? `${e.label}: give one number, not "${answer.trim()}"; for a dilution, give the fold (${ratio[2]} for ${ratio[2]}-fold)`
          : `${e.label}: give a number, or a number with its unit, not "${answer}"`,
      );
    }
  }
  const missing = a.essentials
    .filter((e) => answers[e.id] === undefined)
    .map((e) => ({ id: e.id, label: e.label }));
  const missingLines = missing.map((m) => `Still needed: ${m.label}`);

  const factors: ResolvedFactor[] = [];
  let waiting = false;
  for (const f of a.factors ?? []) {
    let levels: Level[];
    if (f.levels)
      levels = f.levels.map((l) => ({
        id: l.id,
        label:
          l.label ??
          (isQuantity(l.value)
            ? formatQuantity(l.value)
            : typeof l.value === 'string'
              ? l.value
              : l.id),
        ...(l.value !== undefined ? { value: l.value } : {}),
      }));
    else if (f.series) levels = seriesLevels(f.series);
    else {
      const answer = answers[f.from as string];
      if (answer === undefined) {
        waiting = true;
        continue;
      }
      const given = subjects.get(f.from as string);
      levels = given
        ? given.map((r, i) => ({ id: `s${i + 1}`, label: r.label, value: r.id }))
        : Array.from({ length: answer as number }, (_, i) => ({
            id: `s${i + 1}`,
            label: `Subject ${i + 1}`,
          }));
    }
    factors.push({
      id: f.id,
      label: f.label,
      levels,
      ...(f.baseline ? { baseline: f.baseline } : {}),
    });
  }
  if (waiting)
    return {
      missing,
      conditions: [],
      lines: [...missingLines, 'Conditions and totals wait for the inputs above'],
      subjects,
      factors,
    };
  try {
    const conditions = designConditions(factors, a.design ?? 'full_factorial');
    if (wellsPerPlate === undefined)
      return { missing, conditions, lines: missingLines, subjects, factors };
    const { lines, ...totals } = designTotals({
      conditions: conditions.length,
      technical: a.replicates.technical,
      biological: a.replicates.biological ?? 1,
      controls: (a.controls ?? []).map((c) => ({ label: c.label, wells: c.wells, per: c.per })),
      wellsPerPlate,
    });
    return { missing, conditions, totals, lines: [...missingLines, ...lines], subjects, factors };
  } catch (error) {
    if (error instanceof DesignError) throw new OperationError('invalid_input', error.message);
    throw error;
  }
}

export const assayOperations = [
  implement(assaysDraftTemplate, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      service(deps).create(ctx, {
        kind: 'assay_template',
        label,
        attributes,
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the assay template ${label}`,
      }),
  }),
  implement(assaysDesign, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      let a: AssayTemplateAttributes;
      if (input.attributes) {
        if (input.template)
          throw new OperationError(
            'invalid_input',
            'Give a saved template or attributes, not both',
          );
        a = input.attributes;
      } else if (input.template) {
        const record = await recordAt(deps, ctx, input.template, input.version);
        if (record?.kind !== 'assay_template')
          throw new OperationError(
            'not_found',
            `${input.template}${input.version ? ` version ${input.version}` : ''} is not an assay template`,
          );
        a = record.attributes as AssayTemplateAttributes;
      } else {
        throw new OperationError('invalid_input', 'Give a saved template or template attributes');
      }
      let wellsPerPlate = input.wellsPerPlate;
      if (wellsPerPlate === undefined && a.layout) {
        const layout = await recordAt(deps, ctx, a.layout.id, a.layout.version);
        if (layout?.kind === 'layout')
          wellsPerPlate = (layout.attributes as LayoutAttributes).wells;
      }
      if (wellsPerPlate === undefined)
        throw new OperationError(
          'invalid_input',
          'The template has no layout to take the plate format from; give wellsPerPlate',
        );
      const worked = await workOut(deps, ctx, a, input.answers ?? {}, wellsPerPlate);
      const show = input.show ?? 50;
      return {
        missing: worked.missing,
        conditions: worked.conditions.length,
        listed: worked.conditions.slice(0, show),
        more: Math.max(0, worked.conditions.length - show),
        ...(worked.totals ? { totals: worked.totals } : {}),
        lines: worked.lines,
      };
    },
  }),
  implement(assaysSearch, {
    run: async (ctx, input, deps) => {
      const status = input.status ?? 'any';
      const list = await service(deps).list(ctx, {
        kind: 'assay_template',
        ...(status === 'any' ? {} : { status }),
        limit: 500,
      });
      const text = input.text?.toLowerCase();
      const templates = list
        .filter((r) => {
          const a = r.attributes as AssayTemplateAttributes;
          if (text && !`${r.label} ${r.name} ${a.purpose}`.toLowerCase().includes(text))
            return false;
          if (
            input.assay &&
            !(a.assays ?? []).some((x) => x.toLowerCase() === input.assay?.toLowerCase())
          )
            return false;
          if (input.capability && !a.readouts.some((x) => x.capability === input.capability))
            return false;
          return true;
        })
        .sort((x, y) => Number(y.status === 'active') - Number(x.status === 'active'))
        .slice(0, input.limit ?? 25)
        .map((r) => {
          const a = r.attributes as AssayTemplateAttributes;
          return {
            id: r.id,
            name: r.name,
            label: r.label,
            status: r.status,
            version: r.version,
            purpose: a.purpose,
            assays: a.assays ?? [],
            parts: a.parts.length,
            readouts: a.readouts.map((x) => x.label),
            essentials: a.essentials.map((e) => e.label),
          };
        });
      return { templates };
    },
  }),
  implement(assaysSaveFromExperiment, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const { experiment: id, version: asked, label, evidence: given, reason, ...set } = input;
      const current = await service(deps)
        .get(ctx, id)
        .catch(() => undefined);
      if (current?.kind !== 'experiment')
        throw new OperationError('not_found', `${id} is not an experiment`);
      const version = asked ?? current.version;
      const pinned = await recordAt(deps, ctx, current.id, version);
      if (!pinned)
        throw new OperationError('not_found', `${current.name} has no version ${version}`);
      if (pinned.status !== 'active')
        throw new OperationError(
          'invalid_input',
          `${current.name} v${version} is not confirmed; save a design a person confirmed`,
        );
      const e = pinned.attributes as ExperimentAttributes;
      const fromExperiment = { id: current.id, version };

      // What the experiment was designed from, when it was; its values are copied unless given.
      let base: Partial<AssayTemplateAttributes> = {};
      let baseName: string | undefined;
      if (e.template) {
        const template = await recordAt(deps, ctx, e.template.id, e.template.version);
        if (template?.kind === 'assay_template') {
          base = template.attributes as AssayTemplateAttributes;
          baseName = `${template.name} v${e.template.version}`;
        }
      }
      const copied = (
        [
          'assays',
          'layout',
          'essentials',
          'factors',
          'design',
          'controls',
          'replicates',
          'readouts',
          'quality',
          'analysis',
          'hitRule',
          'next',
          'notes',
        ] as const
      ).filter((k) => set[k] === undefined && base[k] !== undefined);
      const essentials = set.essentials ?? base.essentials;
      const replicates = set.replicates ?? base.replicates;
      const readouts = set.readouts ?? base.readouts;
      const lacking = [
        essentials ? undefined : 'essentials (what the designer asks for)',
        replicates ? undefined : 'replicates',
        readouts ? undefined : 'readouts',
      ].filter(Boolean);
      if (lacking.length)
        throw new OperationError(
          'invalid_input',
          `${current.name} was not designed from a template, so give ${lacking.join(', ')}`,
        );

      // The experiment's SOP versions, with the values it set that the designer won't ask for.
      const asks = new Set(
        (essentials ?? []).flatMap((x) =>
          x.input === 'variable' ? [`${x.part}/${x.variable}`] : [],
        ),
      );
      const kept: string[] = [];
      const parts = e.protocol.map((step) => {
        const inputs = (step.inputs ?? []).filter((i) => !asks.has(`${step.id}/${i.name}`));
        kept.push(...inputs.map((i) => i.name));
        return {
          id: step.id,
          sop: step.sop,
          ...(inputs.length ? { inputs } : {}),
          ...(step.note ? { note: step.note } : {}),
        };
      });

      // The materials it bound become default records; instruments it bound go first as preferred.
      const roles = structuredClone(set.roles ?? base.roles ?? []);
      let bound = 0;
      for (const step of e.protocol)
        for (const b of step.bindings ?? []) {
          const record = await service(deps)
            .get(ctx, b.record)
            .catch(() => undefined);
          if (!record) continue;
          bound += 1;
          const role = roles.find((r) => r.part === step.id && r.role === b.role);
          if (record.kind === 'instrument') {
            if (role?.capability)
              role.preferred = [
                record.id,
                ...(role.preferred ?? []).filter((p) => p !== record.id),
              ];
            else bound -= 1;
            continue;
          }
          if (role) {
            role.record = record.id;
            if (b.version !== undefined) role.version = b.version;
            else delete role.version;
          } else
            roles.push({
              part: step.id,
              role: b.role,
              record: record.id,
              ...(b.version !== undefined ? { version: b.version } : {}),
              reason: `Used in ${current.name}`,
            });
        }

      const attributes: AssayTemplateAttributes = {
        purpose: set.purpose ?? base.purpose ?? e.question,
        ...Object.fromEntries(copied.map((k) => [k, base[k]])),
        ...Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined)),
        parts,
        ...(roles.length ? { roles } : {}),
        essentials: essentials ?? [],
        replicates: replicates as AssayTemplateAttributes['replicates'],
        readouts: readouts as AssayTemplateAttributes['readouts'],
      };
      const evidence: Record<string, EvidenceInput> = {
        parts: { source: 'record', from: fromExperiment },
        ...(bound ? { roles: { source: 'record', from: fromExperiment } } : {}),
        ...(set.purpose || base.purpose
          ? {}
          : { purpose: { source: 'record', from: { ...fromExperiment, path: '/question' } } }),
        ...(e.template
          ? Object.fromEntries(
              [...copied, ...(set.purpose ? [] : ['purpose'])].map((k) => [
                k,
                { source: 'template', from: { ...e.template, path: `/${k}` } },
              ]),
            )
          : {}),
        ...(e.template && !bound && !set.roles && base.roles
          ? { roles: { source: 'template', from: { ...e.template, path: '/roles' } } }
          : {}),
        ...given,
      };
      const template = await service(deps).create(ctx, {
        kind: 'assay_template',
        label,
        attributes,
        evidence,
        reason: reason ?? `Saved ${current.name} v${version} as an assay template`,
      });
      const lines = [
        `Drafted ${template.name} ${label} from ${current.name} v${version}`,
        `Parts: ${parts.length} ${parts.length === 1 ? 'SOP' : 'SOPs'} at the versions it used${kept.length ? `, keeping ${kept.join(', ')}` : ''}`,
        ...(bound
          ? [`Roles: ${bound} bound ${bound === 1 ? 'record' : 'records'} kept as defaults`]
          : []),
        ...(baseName && copied.length ? [`Copied from ${baseName}: ${copied.join(', ')}`] : []),
        ...(Object.keys(set).length
          ? [
              `Given: ${Object.keys(set)
                .filter((k) => set[k as keyof typeof set] !== undefined)
                .join(', ')}`,
            ]
          : []),
        'A person confirms it before experiments are designed from it',
      ];
      return { template, lines };
    },
  }),
];
