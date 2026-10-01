import { evaluateVariables, getUnit, isUnit, type VariableDefinition } from '@ailab/domain';
import { type CheckResult, defineKind, type Quantity, SopAttributes } from '@ailab/schema';
import { citationsOf } from './citations.ts';
import { bindRoles, readField } from './resolve.ts';

const PLAN = '(plan 012, digital SOPs)';

const check = (
  id: string,
  label: string,
  severity: CheckResult['severity'],
  problem: string | undefined,
  fix: string,
  section: string,
): CheckResult => ({
  id,
  label,
  severity,
  source: PLAN,
  section,
  passed: problem === undefined,
  ...(problem ? { message: problem } : {}),
  fix,
});

const duplicates = (names: readonly string[]) => [
  ...new Set(names.filter((n, i) => names.indexOf(n) !== i)),
];

const unitsOf = (a: SopAttributes): { where: string; unit: string }[] => {
  const out: { where: string; unit: string }[] = [];
  const add = (where: string, v: unknown) => {
    if (v && typeof v === 'object' && 'unit' in v) out.push({ where, unit: (v as Quantity).unit });
    if (Array.isArray(v)) for (const x of v) add(where, x);
  };
  for (const v of a.variables) {
    add(`variable ${v.name}`, v.value);
    add(`variable ${v.name}`, v.min);
    add(`variable ${v.name}`, v.max);
    if (v.unit) out.push({ where: `variable ${v.name}`, unit: v.unit });
  }
  for (const s of a.steps) for (const p of s.parameters ?? []) add(`step ${s.id}`, p.quantity);
  for (const t of a.timing ?? []) {
    for (const q of [t.min, t.max, t.target, t.tolerance]) add(`timing of step ${t.step}`, q);
  }
  return out;
};

/** How a variable feeds a formula at design time: inputs and defaults by their value, record variables by their typical value. */
export function sopVariableDefinitions(a: SopAttributes): VariableDefinition[] {
  return a.variables.map((v) => ({
    name: v.name,
    ...(v.expression === undefined ? {} : { expression: v.expression }),
    ...(v.value === undefined || v.expression !== undefined ? {} : { value: v.value }),
    ...(v.unit === undefined ? {} : { unit: v.unit }),
  }));
}

/**
 * A digital SOP (plan 012a): materials by role, variables, typed steps, layout, timing and open
 * questions. Drafted by a person or an agent, confirmed section by section; a confirmed version is
 * what experiments follow.
 */
export const sop = defineKind({
  kind: 'sop',
  idPrefix: 'sop',
  namePrefix: 'SOP',
  nameWidth: 4,
  attributes: SopAttributes,
  links: (a) => [
    ...(a.source ? [{ toId: a.source.document, relation: 'digitized_from' }] : []),
    ...(a.derivedFrom ? [{ toId: a.derivedFrom, relation: 'derived_from' }] : []),
    ...[...new Set(a.materials.flatMap((m) => (m.default ? [m.default] : [])))].map((toId) => ({
      toId,
      relation: 'uses',
    })),
    ...[...new Set(a.steps.flatMap((s) => (s.prerequisite ? [s.prerequisite] : [])))].map(
      (toId) => ({ toId, relation: 'requires' }),
    ),
    ...[...new Set((a.solutions ?? []).flatMap((s) => (s.recipe ? [s.recipe] : [])))].map(
      (toId) => ({ toId, relation: 'made_with' }),
    ),
    ...[
      ...new Set(
        citationsOf(a)
          .map((c) => c.cite.document)
          .filter((d) => d !== a.source?.document),
      ),
    ].map((toId) => ({ toId, relation: 'cites' })),
  ],
  // The first sentence of the purpose, and how many steps (ADR 0050).
  summarize: (a) =>
    [a.purpose?.split(/(?<=\.)\s/)[0], a.steps.length ? `${a.steps.length} steps` : undefined]
      .filter(Boolean)
      .join(' · '),
  // Each step, value, material and question keeps its own evidence and confirmation (ADR 0049).
  items: {
    steps: 'id',
    variables: 'name',
    materials: 'role',
    solutions: 'role',
    questions: 'id',
  },
  sections: [
    {
      id: 'overview',
      title: 'Overview',
      fields: ['purpose', 'scope', 'safety', 'assays', 'source', 'derivedFrom', 'notes'],
    },
    { id: 'materials', title: 'Materials', fields: ['materials', 'solutions'] },
    { id: 'variables', title: 'Values', fields: ['variables'] },
    { id: 'procedure', title: 'Steps', fields: ['steps'] },
    { id: 'layout', title: 'Plate layout', fields: ['layout'] },
    { id: 'analysis', title: 'Analysis', fields: ['analysis'] },
    { id: 'timing', title: 'Timing', fields: ['timing'] },
    { id: 'questions', title: 'Open questions', fields: ['questions'] },
  ],
  related: async (a, { get, actor, current }) => {
    const invalid: string[] = [];
    const roles = [...a.materials.map((m) => m.role), ...(a.solutions ?? []).map((s) => s.role)];
    const produced = a.steps.flatMap((s) => (s.produces ?? []).map((p) => p.role));
    const variables = a.variables.map((v) => v.name);
    const steps = a.steps.map((s) => s.id);
    for (const [what, names] of [
      ['role', [...roles, ...produced]],
      ['variable', variables],
      ['step', steps],
    ] as const) {
      for (const d of duplicates(names)) invalid.push(`The ${what} ${d} is named twice`);
    }
    const known = new Set([...roles, ...produced]);
    const variableSet = new Set(variables);
    const stepSet = new Set(steps);
    for (const s of a.steps) {
      for (const r of s.uses ?? []) {
        if (!known.has(r))
          invalid.push(`Step ${s.id} uses ${r}, which is not a material, solution or step output`);
      }
      for (const p of s.parameters ?? []) {
        if (p.variable && !variableSet.has(p.variable)) {
          invalid.push(`Step ${s.id}'s ${p.name} is ${p.variable}, which is not a variable`);
        }
      }
    }
    for (const v of a.variables) {
      if (v.readFrom && !known.has(v.readFrom.role)) {
        invalid.push(`${v.name} is read from ${v.readFrom.role}, which is not a material`);
      }
    }
    for (const l of a.layout ?? []) {
      for (const n of [l.count, l.replicates]) {
        if (typeof n === 'string' && !variableSet.has(n)) {
          invalid.push(`The layout's ${l.label} uses ${n}, which is not a variable`);
        }
      }
    }
    for (const t of a.timing ?? []) {
      for (const s of [t.step, t.after]) {
        if (s !== undefined && !stepSet.has(s))
          invalid.push(`A timing rule names step ${s}, which is not a step`);
      }
    }
    for (const q of a.questions ?? []) {
      if (q.about?.step && !stepSet.has(q.about.step))
        invalid.push(`Question ${q.id} is about step ${q.about.step}, which is not a step`);
      if (q.about?.variable && !variableSet.has(q.about.variable))
        invalid.push(`Question ${q.id} is about ${q.about.variable}, which is not a variable`);
      if (q.status === 'answered' && !q.answer)
        invalid.push(`Question ${q.id} is answered but has no answer`);
    }
    // A person settles a question (sops.answer_question, G6); an agent's write, approved or not,
    // keeps each question's status and answer as they were, and asks new ones open.
    if (actor?.type === 'agent') {
      const before = new Map(
        ((current?.attributes as SopAttributes | undefined)?.questions ?? []).map((q) => [q.id, q]),
      );
      for (const q of a.questions ?? []) {
        const was = before.get(q.id);
        if (q.status !== (was?.status ?? 'open') || q.answer !== was?.answer)
          invalid.push(
            `Question ${q.id} is for a person to answer (sops.answer_question); leave its status and answer as they are`,
          );
      }
    }
    for (const { where, unit } of unitsOf(a)) {
      if (!isUnit(unit)) invalid.push(`${where}: unknown unit "${unit}"`);
    }
    if (a.source && (await get(a.source.document))?.kind !== 'document') {
      invalid.push(`${a.source.document} is not a library document in this lab`);
    }
    if (a.derivedFrom && (await get(a.derivedFrom))?.kind !== 'sop') {
      invalid.push(`${a.derivedFrom} is not an SOP in this lab`);
    }
    for (const id of new Set([
      ...a.materials.flatMap((m) => (m.default ? [m.default] : [])),
      ...a.steps.flatMap((s) => (s.prerequisite ? [s.prerequisite] : [])),
    ])) {
      if (!(await get(id))) invalid.push(`${id} is not a record in this lab`);
    }
    for (const id of new Set((a.solutions ?? []).flatMap((s) => (s.recipe ? [s.recipe] : [])))) {
      if ((await get(id))?.kind !== 'product') invalid.push(`${id} is not a product in this lab`);
    }
    for (const id of new Set(citationsOf(a).map((c) => c.cite.document))) {
      if ((await get(id))?.kind !== 'document')
        invalid.push(`${id} is cited but is not a library document in this lab`);
    }
    if (invalid.length > 0) return { invalid };

    const fetch = get;
    const bindings = await bindRoles(a, new Map(), fetch);
    const misfits = bindings.flatMap((b) => (b.problem ? [b.problem] : []));
    const unreadable: string[] = [];
    for (const v of a.variables) {
      if (v.kind !== 'record' || !v.readFrom) continue;
      const b = bindings.find((x) => x.role === v.readFrom?.role);
      if (!b?.record || b.problem) continue;
      const read = await readField(b.record, v.readFrom.field, fetch);
      if (read.problem) unreadable.push(`${v.name}: ${read.problem}`);
    }
    const outcomes = evaluateVariables(sopVariableDefinitions(a));
    const broken = a.variables.flatMap((v) => {
      if (v.expression === undefined) return [];
      const o = outcomes.get(v.name);
      return o && !o.ok && !o.waitsOn ? [`${v.name}: ${o.error}`] : [];
    });
    const timingNotTime = (a.timing ?? []).flatMap((t) =>
      [t.min, t.max, t.target, t.tolerance].some(
        (q) => q !== undefined && getUnit(q.unit).dimension !== 'time',
      )
        ? [`step ${t.step}`]
        : [],
    );
    const open = (a.questions ?? []).filter((q) => q.status === 'open');
    const uncited = a.source ? a.steps.filter((s) => !s.cite?.length) : [];
    return {
      checks: [
        check(
          'has_steps',
          'It has steps',
          'blocker',
          a.steps.length === 0 ? 'No steps yet' : undefined,
          'Add the procedure steps',
          'procedure',
        ),
        check(
          'materials_fit',
          'Default records fit their roles',
          'blocker',
          misfits.length ? misfits.join('; ') : undefined,
          'Pick a default of the kind the role needs, or leave it empty',
          'materials',
        ),
        check(
          'record_values_readable',
          'Record variables can be read from their defaults',
          'warning',
          unreadable.length ? unreadable.join('; ') : undefined,
          'Point readFrom at a field the record has, or fill it on the record',
          'variables',
        ),
        check(
          'formulas_work',
          'Formulas work out',
          'blocker',
          broken.length ? broken.join('; ') : undefined,
          'Fix the formula or the units of the values it uses; try it with sops.evaluate',
          'variables',
        ),
        check(
          'timing_is_time',
          'Timing windows are times',
          'blocker',
          timingNotTime.length ? `Not a time: ${timingNotTime.join(', ')}` : undefined,
          'Give each window in s, min, h or d',
          'timing',
        ),
        check(
          'questions_answered',
          'Open questions are answered',
          'blocker',
          open.length ? `${open.length} open: ${open.map((q) => q.question).join(' ')}` : undefined,
          'Answer each question or accept its suggestion',
          'questions',
        ),
        check(
          'steps_cite_source',
          'Steps cite the source',
          'warning',
          uncited.length
            ? `${uncited.length} step${uncited.length === 1 ? '' : 's'} without a passage: ${uncited.map((s) => s.id).join(', ')}`
            : undefined,
          'Cite the passage each step comes from, so a reviewer can check it',
          'procedure',
        ),
      ],
    };
  },
});

export const sopKinds = [sop];
