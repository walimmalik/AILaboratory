import { formatQuantity } from '@ailab/domain';
import {
  type AssayTemplateAttributes,
  type CapabilityId,
  designerFeasibility,
  designerStart,
  type ExperimentAttributes,
  type InstrumentAttributes,
  type LayoutAttributes,
  type RecordEnvelope,
  type ResolvedConfiguration,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { type Answers, recordAt, workOut } from './operations.ts';

/**
 * The designer (plan 017b, D3): from a confirmed assay template and the answers to its essential
 * inputs, drafts the experiment (013) and, when the subjects are records and the template has a
 * layout, its plate map (014), in one write. Everything stays a draft a person confirms.
 */

/** Physical things are bound by id; definitions are pinned by version (ADR 0039). */
const BOUND_BY_ID = new Set(['container', 'sample', 'instrument']);

/** Template well roles as an experiment names its controls. */
const CONTROL_ROLE: Record<string, NonNullable<ExperimentAttributes['controls']>[number]['role']> =
  {
    standard: 'standard',
    blank: 'blank',
    neutral_control: 'neutral',
    positive_control: 'positive',
    negative_control: 'negative',
    vehicle: 'vehicle',
  };

/** "10 points from 10 µM" style summary of a factor's levels, at most six named. */
const levelWords = (labels: string[]) =>
  labels.length <= 6
    ? labels.join(', ')
    : `${labels.slice(0, 6).join(', ')} and ${labels.length - 6} more`;

async function run<T>(deps: OperationDeps, ctx: RecordContext, id: string, input: unknown) {
  const result = await deps.registry.execute(ctx, id, input, {}, deps.db);
  if (result.status !== 'done')
    throw new OperationError('invalid_input', `${id} was ${result.status}, not done`);
  return result.output as T;
}

export const designerOperations: ReturnType<typeof implement>[] = [
  implement(designerStart, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const records = new RecordService(deps.db, deps.kinds);
      const current = await records.get(ctx, input.template).catch(() => undefined);
      if (current?.kind !== 'assay_template')
        throw new OperationError('not_found', `${input.template} is not an assay template`);
      const version = input.version ?? current.version;
      const pinned = await recordAt(deps, ctx, current.id, version);
      if (!pinned)
        throw new OperationError('not_found', `${current.name} has no version ${version}`);
      if (pinned.status !== 'active')
        throw new OperationError(
          'invalid_input',
          `${current.name} v${version} is not confirmed; a person confirms the template before experiments are designed from it`,
        );
      const a = pinned.attributes as AssayTemplateAttributes;
      const from = { id: current.id, version };

      const layout = a.layout
        ? await recordAt(deps, ctx, a.layout.id, a.layout.version)
        : undefined;
      const wells = layout ? (layout.attributes as LayoutAttributes).wells : undefined;
      const worked = await workOut(deps, ctx, a, input.answers as Answers, wells);
      if (worked.missing.length)
        throw new OperationError(
          'invalid_input',
          `Still needed: ${worked.missing.map((m) => m.label).join(', ')}`,
        );

      // The SOP parts, each with the template's default records and the variables answered.
      const defaults = new Map<string, RecordEnvelope>();
      for (const r of a.roles ?? [])
        if (r.record) {
          const record = await records.get(ctx, r.record).catch(() => undefined);
          if (!record)
            throw new OperationError(
              'invalid_input',
              `The template binds ${r.role} to ${r.record}, which is not in this lab`,
            );
          defaults.set(`${r.part}/${r.role}`, record);
        }
      const protocol: ExperimentAttributes['protocol'] = a.parts.map((p) => {
        const bindings = (a.roles ?? []).flatMap((r) => {
          const record = r.part === p.id ? defaults.get(`${p.id}/${r.role}`) : undefined;
          if (!record) return [];
          return [
            {
              role: r.role,
              record: record.id,
              ...(BOUND_BY_ID.has(record.kind) ? {} : { version: r.version ?? record.version }),
            },
          ];
        });
        const inputs = [
          ...(p.inputs ?? []),
          ...a.essentials.flatMap((e) => {
            if (e.input !== 'variable' || e.part !== p.id) return [];
            const value = input.answers[e.id];
            return value === undefined || Array.isArray(value) || typeof value === 'number'
              ? typeof value === 'number'
                ? [{ name: e.variable, value: String(value) }]
                : []
              : [{ name: e.variable, value }];
          }),
        ];
        return {
          id: p.id,
          sop: p.sop,
          ...(bindings.length ? { bindings } : {}),
          ...(inputs.length ? { inputs } : {}),
          ...(p.note ? { note: p.note } : {}),
        };
      });

      const subjects = [...worked.subjects.values()].flat();
      const counted = a.essentials.flatMap((e) =>
        e.input === 'subjects' && typeof input.answers[e.id] === 'number'
          ? [input.answers[e.id] as number]
          : [],
      );
      const n = subjects.length + counted.reduce((x, y) => x + y, 0);
      const label = input.label ?? `${current.label}: ${n} ${n === 1 ? 'subject' : 'subjects'}`;

      const conditions = worked.factors.map((f) => ({
        id: f.id,
        label: f.label,
        text: levelWords(f.levels.map((l) => l.label)),
      }));
      const controls = (a.controls ?? []).flatMap((c) =>
        CONTROL_ROLE[c.role]
          ? [
              {
                id: c.id,
                label: c.label,
                role: CONTROL_ROLE[c.role],
                ...(c.subject ? { subject: c.subject } : {}),
                text: `${c.wells} ${c.wells === 1 ? 'well' : 'wells'} per ${c.per}; ${c.reason}`,
              },
            ]
          : [],
      );
      const readouts = a.readouts.map((r) => ({
        id: r.id,
        label: r.label,
        text: [
          r.capability.replaceAll('_', ' '),
          r.mode,
          r.wavelengths?.map((w) => `${w.use} ${formatQuantity(w.wavelength)}`).join(', '),
        ]
          .filter(Boolean)
          .join('; '),
      }));
      const successCriteria = (a.quality ?? []).map(
        (q) => `${q.measure} ${q.comparison} ${q.threshold} per ${q.per}`,
      );

      const copied = { source: 'template' as const, from };
      const attributes = {
        campaign: input.campaign,
        ...(input.aim ? { aim: input.aim } : {}),
        question: input.question ?? a.purpose,
        ...(subjects.length ? { subjects: subjects.map((s) => ({ record: s.id })) } : {}),
        protocol,
        template: from,
        ...(conditions.length ? { conditions } : {}),
        ...(controls.length ? { controls } : {}),
        readouts,
        ...(successCriteria.length ? { successCriteria } : {}),
      };
      const evidence = {
        ...(input.question
          ? {}
          : { question: { source: 'assumed' as const, note: "The template's purpose" } }),
        protocol: copied,
        ...(conditions.length ? { conditions: copied } : {}),
        ...(controls.length ? { controls: copied } : {}),
        readouts: copied,
        ...(successCriteria.length ? { successCriteria: copied } : {}),
      };
      const experiment = await run<RecordEnvelope>(deps, ctx, 'experiments.draft', {
        label,
        ...attributes,
        evidence,
        reason: input.reason ?? `Designed from ${current.name} v${version}`,
      });

      const lines = [`Drafted ${experiment.name} ${label} from ${current.name} v${version}`];
      // The plate map places the subjects when they are what varies, with the layout's controls.
      let plateMap: RecordEnvelope | undefined;
      const onlyFactor = (a.factors ?? []).length === 1 ? a.factors?.[0] : undefined;
      const placed = onlyFactor?.from ? worked.subjects.get(onlyFactor.from) : undefined;
      if (a.layout && layout?.kind === 'layout' && placed?.length) {
        const plate = [...defaults.values()].find((r) => r.kind === 'labware_type');
        const regions = new Set(
          ((layout.attributes as LayoutAttributes).fixed ?? []).map((f) => f.id),
        );
        const regionControls = (a.controls ?? []).flatMap((c) =>
          c.subject && regions.has(c.id) ? [{ region: c.id, record: c.subject }] : [],
        );
        plateMap = await run<RecordEnvelope>(deps, ctx, 'platemaps.draft', {
          label: `${label}, plate map`,
          layout: a.layout.id,
          layoutVersion: a.layout.version,
          experiment: experiment.id,
          subjects: placed.map((s) => ({ record: s.id })),
          ...(plate ? { labware: { id: plate.id, version: plate.version } } : {}),
          ...(regionControls.length ? { controls: regionControls } : {}),
          reason: `Designed from ${current.name} v${version}`,
        });
        lines.push(`Drafted ${plateMap.name}, its plate map`);
      } else if (a.layout)
        lines.push(
          onlyFactor?.from
            ? 'No plate map yet: give the subjects as records to place them'
            : 'No plate map yet: place the conditions with platemaps.draft',
        );
      if (worked.totals) lines.push(...worked.lines);
      return {
        experiment,
        ...(plateMap ? { plateMap } : {}),
        ...(worked.totals
          ? {
              totals: {
                conditions: worked.totals.conditions,
                plates: worked.totals.plates,
                totalPlates: worked.totals.totalPlates,
                totalWells: worked.totals.totalWells,
              },
            }
          : {}),
        lines,
      };
    },
  }),
];

/** The answers a drafted experiment gives back to its template: subjects and variable inputs. */
function answersOf(a: AssayTemplateAttributes, e: ExperimentAttributes): Answers {
  const answers: Answers = {};
  const subjects = (e.subjects ?? []).map((s) => s.record);
  for (const input of a.essentials) {
    if (input.input === 'subjects') {
      if (subjects.length) answers[input.id] = subjects;
      continue;
    }
    const value = e.protocol
      .find((p) => p.id === input.part)
      ?.inputs?.find((i) => i.name === input.variable)?.value;
    if (value !== undefined && !Array.isArray(value)) answers[input.id] = value;
  }
  return answers;
}

designerOperations.push(
  implement(designerFeasibility, {
    run: async (ctx, input, deps) => {
      const experiment = await recordAt(deps, ctx, input.experiment, input.version);
      if (experiment?.kind !== 'experiment')
        throw new OperationError('not_found', `${input.experiment} is not an experiment`);
      const e = experiment.attributes as ExperimentAttributes;
      if (!e.template)
        throw new OperationError(
          'invalid_input',
          `${experiment.name} was not designed from an assay template; check its amounts with experiments.calculate`,
        );
      const template = await recordAt(deps, ctx, e.template.id, e.template.version);
      if (template?.kind !== 'assay_template')
        throw new OperationError('not_found', `${e.template.id} is not an assay template`);
      const a = template.attributes as AssayTemplateAttributes;
      const layout = a.layout
        ? await recordAt(deps, ctx, a.layout.id, a.layout.version)
        : undefined;
      const wells = layout ? (layout.attributes as LayoutAttributes).wells : undefined;

      // What each registered instrument can do now, on this plate format.
      const records = new RecordService(deps.db, deps.kinds);
      const instruments = (await records.list(ctx, { kind: 'instrument', limit: 500 })).filter(
        (i) => i.status !== 'archived',
      );
      const can = new Map<string, Set<string>>();
      for (const instrument of instruments) {
        const resolved = await deps.registry
          .execute(ctx, 'instruments.resolve', { instrument: instrument.id }, {}, deps.db)
          .then((r) => (r.status === 'done' ? (r.output as ResolvedConfiguration) : undefined))
          .catch(() => undefined);
        can.set(
          instrument.id,
          new Set(
            (resolved?.capabilities ?? [])
              .filter((c) => !wells || !c.limits?.wellCounts || c.limits.wellCounts.includes(wells))
              .map((c) => c.capability),
          ),
        );
      }
      const needOf = (what: string, capability: string, preferred: string[] = []) => {
        const able = instruments
          .filter((i) => can.get(i.id)?.has(capability))
          .map((i) => {
            const ia = i.attributes as InstrumentAttributes;
            return {
              id: i.id,
              name: i.name,
              label: i.label,
              status: ia.status,
              preferred: preferred.includes(i.id) || preferred.includes(ia.kind),
            };
          })
          .sort((x, y) => Number(y.preferred) - Number(x.preferred));
        const verdict = able.some((i) => i.status === 'ready' || i.status === 'in_use')
          ? ('ready' as const)
          : able.length
            ? ('not_ready' as const)
            : ('missing' as const);
        return { for: what, capability: capability as CapabilityId, instruments: able, verdict };
      };
      const needs = [
        ...(a.roles ?? []).flatMap((r) =>
          r.capability
            ? [needOf(`the role ${r.role} in ${r.part}`, r.capability, r.preferred)]
            : [],
        ),
        ...a.readouts
          .filter((r) => !(a.roles ?? []).some((x) => x.capability === r.capability))
          .map((r) => needOf(`the readout ${r.label}`, r.capability)),
      ];

      const worked = await workOut(deps, ctx, a, answersOf(a, e), wells).catch(() => undefined);
      const calculated = await run<{
        parts: { part: string; problems: string[] }[];
        ready: boolean;
      }>(deps, ctx, 'experiments.calculate', { id: experiment.id, version: experiment.version });
      const problems = calculated.parts.flatMap((p) => p.problems.map((x) => `${p.part}: ${x}`));

      const lines = needs.map((n) => {
        const words = n.capability.replaceAll('_', ' ');
        if (n.verdict === 'missing')
          return `No instrument in the lab can ${words}${wells ? ` on ${wells}-well plates` : ''}`;
        const first = n.instruments[0];
        const named = `${first?.label} ${first?.name}`;
        return n.verdict === 'ready'
          ? `${capitalize(words)}: ${n.instruments
              .filter((i) => i.status === 'ready' || i.status === 'in_use')
              .map((i) => `${i.label} ${i.name}`)
              .join(', ')}`
          : `${capitalize(words)}: only ${named}, which is ${first?.status.replaceAll('_', ' ')}`;
      });
      if (worked?.totals) lines.push(...worked.lines.filter((l) => !l.startsWith('Still needed')));
      else lines.push('Plates and wells wait for the subjects, given as records');
      if (problems.length) lines.push(...problems.map((p) => `Amounts: ${p}`));
      lines.push(
        'Stock on hand is not checked yet; reagent volumes against stock come with reservations',
      );
      return {
        template: { id: template.id, name: template.name, version: e.template.version },
        needs,
        ...(worked?.totals
          ? {
              totals: {
                conditions: worked.totals.conditions,
                plates: worked.totals.plates,
                totalPlates: worked.totals.totalPlates,
                totalWells: worked.totals.totalWells,
              },
            }
          : {}),
        amounts: { ready: calculated.ready, problems },
        feasible: calculated.ready && needs.every((n) => n.verdict === 'ready'),
        lines,
      };
    },
  }),
);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
