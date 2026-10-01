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
  assaysSearch,
  type LayoutAttributes,
  type Quantity,
  type RecordEnvelope,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

/**
 * Assay templates (plan 017a, ADR 0065): drafting one, working out what it gives for a request
 * (missing inputs, conditions, wells and plates), and finding the lab's templates. Updating and
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
];
