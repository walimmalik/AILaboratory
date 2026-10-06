import {
  type Actor,
  type Converted,
  type ExactSourceReference,
  type Readiness,
  type RecordEnvelope,
  type SopAttributes,
  SopExpectation,
} from '@ailab/schema';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Assistant } from '../assistant/assistant.ts';
import type { ChatModel, ModelRequest, ModelTurn } from '../assistant/model.ts';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { proposals, records, recordVersions } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { labwareKinds } from '../labware/kinds.ts';
import type { Converter } from '../library/convert.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { benchmarkTable, runBenchmark } from './benchmark.ts';
import { sopKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;
let kinds: KindRegistry;

/** One section per "# " heading, one passage per paragraph. */
const converter: Converter = {
  convert: async ({ bytes }) => {
    const sections: Converted['sections'] = [];
    for (const part of new TextDecoder().decode(bytes).split(/^# /m).filter(Boolean)) {
      const [heading, ...rest] = part.split('\n');
      sections.push({
        heading: [heading as string],
        passages: rest
          .join('\n')
          .split(/\n\n+/)
          .filter((t) => t.trim())
          .map((text) => ({ text: text.trim(), page: 1 })),
      });
    }
    return { converter: 'test', sections, warnings: [] };
  },
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  kinds = new KindRegistry();
  for (const kind of [...labwareKinds, ...reagentKinds, ...fileKinds, ...libraryKinds, ...sopKinds])
    kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus(), undefined, {
    files: new MemoryFileStore(),
    converter,
  });
});
afterEach(() => close());

async function evaluate(ctx: RecordContext, variables: unknown[]) {
  const result = await registry.execute(ctx, 'sops.evaluate', { variables });
  if (result.status !== 'done') throw new Error(`sops.evaluate was ${result.status}`);
  return (result.output as { variables: Record<string, unknown>[] }).variables;
}

describe('sops.evaluate', () => {
  it('works out a diluent volume for the run, for a person and an agent alike', async () => {
    const variables = [
      {
        name: 'diluent',
        expression: 'roundup(n_samples * replicates * well_volume + dead_volume, 1 mL)',
        unit: 'mL',
      },
      { name: 'n_samples', value: '40' },
      { name: 'replicates', value: '2' },
      { name: 'well_volume', value: { value: '100', unit: 'uL' } },
      { name: 'dead_volume', value: { value: '5', unit: 'mL' } },
      {
        name: 'standards',
        value: [
          { value: '100', unit: 'uL' },
          { value: '50', unit: 'uL' },
        ],
      },
      { name: 'standard_total', expression: 'sum(standards)' },
    ];
    for (const ctx of [person, agent]) {
      const out = await evaluate(ctx, variables);
      expect(out[0]).toEqual({ name: 'diluent', ok: true, quantity: { value: '13', unit: 'mL' } });
      expect(out[1]).toEqual({ name: 'n_samples', ok: true, number: '40' });
      expect(out[5]).toMatchObject({ name: 'standards', ok: true, list: expect.any(Array) });
      expect(out[6]).toEqual({
        name: 'standard_total',
        ok: true,
        quantity: { value: '150', unit: 'uL' },
      });
    }
  });

  it('says why a formula has no value', async () => {
    const out = await evaluate(agent, [
      { name: 'working', expression: 'lot_conc / 1000' },
      { name: 'lot_conc' },
      { name: 'wrong', expression: 'well_volume + 5 min' },
      { name: 'well_volume', value: { value: '100', unit: 'uL' } },
    ]);
    expect(out[0]).toEqual({
      name: 'working',
      ok: false,
      error: 'Waits for lot_conc',
      waitsOn: ['lot_conc'],
    });
    expect(out[2]).toEqual({ name: 'wrong', ok: false, error: "Can't add time to volume" });
  });

  it('refuses a name given twice, an unknown unit, and both a value and a formula', async () => {
    const run = (variables: unknown[]) => registry.execute(agent, 'sops.evaluate', { variables });
    await expect(
      run([
        { name: 'a', value: '1' },
        { name: 'a', value: '2' },
      ]),
    ).rejects.toMatchObject({ code: 'invalid_input', message: 'a is given twice' });
    await expect(run([{ name: 'v', value: { value: '1', unit: 'ul' } }])).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'v: unknown unit "ul"',
    });
    await expect(run([{ name: 'v', value: '1', expression: '2' }])).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(run([{ name: '2bad', value: '1' }])).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

/** The error a call is refused with. */
const refused = (call: Promise<unknown>) =>
  call.then(
    () => {
      throw new Error('Expected a refusal');
    },
    (error: Error) => error,
  );

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status !== 'done') throw new Error(`${id} was ${result.status}`);
  return result.output as T;
}

const q = (value: string, unit: string) => ({ value, unit });

/** A short ELISA: coat, wash, read, with a diluent formula and a lot-specific concentration. */
const elisa = {
  label: 'IL-6 ELISA',
  assays: ['ELISA'],
  materials: [
    {
      role: 'coating_plate',
      label: 'Coating plate',
      type: 'labware',
      requirements: '96-well, high binding',
    },
    { role: 'capture_ab', label: 'Capture antibody', type: 'reagent' },
    {
      role: 'reader',
      label: 'Plate reader',
      type: 'instrument',
      requirements: 'Absorbance at 450 nm',
    },
  ],
  solutions: [{ role: 'wash_buffer', label: 'Wash buffer', text: '0.05% Tween 20 in PBS' }],
  variables: [
    { name: 'n_samples', label: 'Samples', kind: 'input', value: '40', min: '1', max: '40' },
    { name: 'replicates', label: 'Replicates', kind: 'default', value: '2' },
    { name: 'well_volume', label: 'Well volume', kind: 'default', value: q('100', 'uL') },
    { name: 'dead_volume', label: 'Dead volume', kind: 'default', value: q('5', 'mL') },
    {
      name: 'capture_conc',
      label: 'Capture antibody working concentration',
      kind: 'record',
      value: q('2', 'ug/mL'),
      readFrom: { role: 'capture_ab', field: 'workingConcentration' },
    },
    {
      name: 'diluent',
      label: 'Coating solution',
      kind: 'computed',
      expression: 'n_samples * replicates * well_volume + dead_volume',
      unit: 'mL',
    },
  ],
  steps: [
    {
      id: 'coat',
      action: 'add',
      title: 'Coat',
      text: 'Add the capture antibody at its working concentration to every well; seal and leave overnight at room temperature.',
      uses: ['coating_plate', 'capture_ab'],
      parameters: [
        { name: 'volume', variable: 'well_volume' },
        { name: 'duration', text: 'overnight' },
      ],
      produces: [{ role: 'coated_plate', label: 'Coated plate' }],
    },
    {
      id: 'wash',
      action: 'wash',
      text: 'Wash with 400 µL wash buffer per well.',
      uses: ['coated_plate', 'wash_buffer'],
      repeat: 3,
      parameters: [{ name: 'volume', quantity: q('400', 'uL') }],
    },
    {
      id: 'read',
      action: 'read',
      text: 'Read absorbance at 450 nm.',
      uses: ['reader'],
      parameters: [{ name: 'wavelength', quantity: q('450', 'nm') }],
    },
  ],
  layout: [{ what: 'samples', label: 'Samples', count: 'n_samples', replicates: 'replicates' }],
  timing: [{ step: 'read', after: 'wash', max: q('30', 'min'), source: 'vendor', enforce: true }],
  questions: [
    {
      id: 'q1',
      about: { step: 'coat' },
      question: 'Overnight at room temperature or at 4 °C?',
      suggestion: 'Room temperature, as the vendor sheet says',
      stage: { stage: 'method', reason: 'The source leaves the method unclear' },
    },
  ],
};

describe('sops.draft', () => {
  it('keeps a genuine source blocker, exact edition and response history through coherent saved step appends', async () => {
    const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'partial-method.md',
      mediaType: 'text/markdown',
      text: '# Method\nUse a tube.\n\nWorksheet: use a plate.\n\nRead at 450 nm.\n\nWait 2 min.\n\nMix gently.\n\nIncubate 3 min.',
    });
    const doc = await run<RecordEnvelope>(person, 'library.add', {
      label: 'Conflicting vessel method',
      type: 'sop',
      license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
      files: [{ file: file.id, role: 'original' }],
    });
    await run(person, 'library.parse', { document: doc.id });
    const { source } = await run<{ source: ExactSourceReference }>(person, 'library.read', {
      document: doc.id,
    });
    const { passages } = await run<{ passages: { id: string; text: string; page?: number }[] }>(
      person,
      'library.read',
      { source, section: 0 },
    );
    const cite = (i: number) => {
      const passage = passages[i];
      if (!passage) throw new Error('Expected retained source passage');
      return { document: doc.id, passage: passage.id, page: passage.page, quote: passage.text };
    };
    let current = await run<RecordEnvelope>(person, 'sops.draft', {
      label: 'Partial source method, vessel unresolved',
      source: { document: doc.id, exact: source },
      materials: [],
      variables: [],
      steps: [],
      questions: [
        {
          id: 'vessel',
          question: 'Which vessel is supported: tube or plate?',
          stage: { stage: 'method', reason: 'The instructions conflict about the vessel' },
          passages: [cite(0), cite(1)],
        },
      ],
    });
    current = await run<RecordEnvelope>(person, 'sops.answer_question', {
      sop: current.id,
      expectedVersion: current.version,
      question: 'vessel',
      action: { type: 'response', text: "I don't know" },
    });
    const originalQuestions = current.attributes.questions;
    const referencedUpdate = (inspected: RecordEnvelope, step: SopAttributes['steps'][number]) => ({
      steps: [
        { operation: 'records.get', input: { id: inspected.id } },
        {
          operation: 'records.update',
          input: {
            id: inspected.id,
            // Literal inspected version: $1.version would accept a concurrently changed index list.
            expectedVersion: inspected.version,
            attributes: {
              ...Object.fromEntries(
                Object.keys(inspected.attributes).map((field) => [field, `$1.attributes.${field}`]),
              ),
              steps: [
                ...(inspected.attributes as SopAttributes).steps.map(
                  (_, index) => `$1.attributes.steps.${index}`,
                ),
                step,
              ],
            },
          },
        },
      ],
    });
    const steps: SopAttributes['steps'] = [
      {
        id: 'read',
        action: 'read',
        title: 'Read',
        text: 'Read at 450 nm.',
        parameters: [{ name: 'wavelength', quantity: q('450', 'nm') }],
        cite: [cite(2)],
      },
      {
        id: 'wait',
        action: 'wait',
        title: 'Wait',
        text: 'Wait 2 min.',
        parameters: [{ name: 'duration', quantity: q('2', 'min') }],
        cite: [cite(3)],
      },
    ];
    for (const step of steps) {
      const prior = current.attributes as SopAttributes;
      await run(person, 'changes.apply', referencedUpdate(current, step));
      current = await run<RecordEnvelope>(person, 'records.get', { id: current.id });
      expect(current.attributes.source).toEqual({ document: doc.id, exact: source });
      expect(current.attributes.questions).toEqual(originalQuestions);
      expect((current.attributes as SopAttributes).steps).toEqual([...prior.steps, step]);
      expect(await run(person, 'sops.check_citations', { sop: current.id })).toMatchObject({
        sourceStatus: 'checked',
        problems: 0,
      });
      const ready = await run<Readiness>(person, 'records.readiness', { id: current.id });
      expect(ready.checks.find((check) => check.id === 'questions_answered')).toMatchObject({
        passed: false,
        severity: 'blocker',
      });
      expect(current.status).toBe('draft');
      await expect(
        registry.execute(person, 'records.activate', {
          id: current.id,
          expectedVersion: current.version,
        }),
      ).rejects.toMatchObject({ code: 'not_ready' });
    }
    expect(
      (current.attributes as SopAttributes).steps.map((step) => [step.id, step.action]),
    ).toEqual([
      ['read', 'read'],
      ['wait', 'wait'],
    ]);
    const inspected = current;
    const concurrentStep: SopAttributes['steps'][number] = {
      id: 'mix',
      action: 'mix',
      text: 'Mix gently.',
      cite: [cite(4)],
    };
    current = await run<RecordEnvelope>(person, 'records.update', {
      id: current.id,
      expectedVersion: current.version,
      attributes: {
        ...current.attributes,
        steps: [...(current.attributes as SopAttributes).steps, concurrentStep],
      },
    });
    const beforeStaleAttempt = current;
    await expect(
      registry.execute(
        person,
        'changes.apply',
        referencedUpdate(inspected, {
          id: 'incubate',
          action: 'incubate',
          text: 'Incubate 3 min.',
          parameters: [{ name: 'duration', quantity: q('3', 'min') }],
          cite: [cite(5)],
        }),
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    current = await run<RecordEnvelope>(person, 'records.get', { id: current.id });
    expect(current).toEqual(beforeStaleAttempt);
    expect(current.attributes.questions).toEqual(originalQuestions);
    expect((current.attributes as SopAttributes).steps.map((step) => step.id)).toEqual([
      'read',
      'wait',
      'mix',
    ]);
  });

  it('retains a cited unfinished wash before read and keeps its method question blocking acceptance', async () => {
    const sourceText =
      '# Procedure\nWash the plate. Use 300 uL wash buffer per well.\n\nAlternate worksheet: use 350 uL wash buffer per well.\n\nRead absorbance at 450 nm.';
    const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'wash-and-read.md',
      mediaType: 'text/markdown',
      text: sourceText,
    });
    const doc = await run<RecordEnvelope>(person, 'library.add', {
      label: 'Wash and read source',
      type: 'sop',
      license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
      files: [{ file: file.id, role: 'original' }],
    });
    await run(person, 'library.parse', { document: doc.id });
    const { passages } = await run<{ passages: { id: string; text: string; page?: number }[] }>(
      person,
      'library.read',
      { document: doc.id, section: 0 },
    );
    const cite = (index: number, quote: string) => ({
      document: doc.id,
      passage: passages[index]?.id,
      page: passages[index]?.page,
      quote,
    });
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', {
      label: 'Wash and read, working volume unresolved',
      source: {
        document: doc.id,
        exact: (
          await run<{ source: ExactSourceReference }>(person, 'library.read', { document: doc.id })
        ).source,
      },
      materials: [
        { role: 'plate', label: 'Plate', type: 'labware' },
        { role: 'wash_buffer', label: 'Wash buffer', type: 'reagent' },
        { role: 'reader', label: 'Plate reader', type: 'instrument' },
      ],
      variables: [],
      steps: [
        {
          id: 'wash',
          action: 'wash',
          title: 'Wash',
          text: 'Wash the plate.',
          uses: ['plate', 'wash_buffer'],
          cite: [cite(0, 'Wash the plate.')],
        },
        {
          id: 'read',
          action: 'read',
          title: 'Read',
          text: 'Read absorbance at 450 nm.',
          uses: ['plate', 'reader'],
          parameters: [{ name: 'wavelength', quantity: q('450', 'nm') }],
          cite: [cite(2, 'Read absorbance at 450 nm.')],
        },
      ],
      questions: [
        {
          id: 'wash_volume',
          about: { step: 'wash' },
          stage: {
            stage: 'method',
            reason: 'The sources disagree on the working wash volume',
          },
          question:
            'Which compatible wash approach is scientifically supported: the 300 uL instruction or the 350 uL worksheet?',
          passages: [
            cite(0, 'Use 300 uL wash buffer per well.'),
            cite(1, 'Alternate worksheet: use 350 uL wash buffer per well.'),
          ],
        },
      ],
    });
    const stored = await run<RecordEnvelope>(person, 'records.get', { id: sop.id });
    expect(stored.attributes).toEqual(sop.attributes);
    const a = stored.attributes as SopAttributes;
    expect(a.steps.map((s) => [s.id, s.action])).toEqual([
      ['wash', 'wash'],
      ['read', 'read'],
    ]);
    expect(a.steps[0]).toEqual({
      id: 'wash',
      action: 'wash',
      title: 'Wash',
      text: 'Wash the plate.',
      uses: ['plate', 'wash_buffer'],
      cite: [cite(0, 'Wash the plate.')],
    });
    expect(a.steps[1]?.parameters).toEqual([{ name: 'wavelength', quantity: q('450', 'nm') }]);
    expect(a.questions?.[0]).toMatchObject({
      id: 'wash_volume',
      about: { step: 'wash' },
      disposition: { status: 'open' },
      responses: [],
    });
    expect(await run(agent, 'sops.check_citations', { sop: sop.id })).toMatchObject({
      problems: 0,
    });

    const stillBlocked = async (current: RecordEnvelope) => {
      const ready = await run<Readiness>(person, 'records.readiness', { id: current.id });
      expect(ready.checks.find((c) => c.id === 'questions_answered')).toMatchObject({
        passed: false,
        severity: 'blocker',
      });
      expect(current.status).toBe('draft');
      await expect(
        registry.execute(person, 'records.activate', {
          id: current.id,
          expectedVersion: current.version,
        }),
      ).rejects.toMatchObject({ code: 'not_ready' });
      return current;
    };
    let current = await run<RecordEnvelope>(person, 'records.confirm', {
      id: stored.id,
      expectedVersion: stored.version,
    });
    current = await stillBlocked(current);
    for (const text of ["I don't know", 'Use the 300 uL instruction']) {
      current = await run<RecordEnvelope>(person, 'sops.answer_question', {
        sop: current.id,
        expectedVersion: current.version,
        question: 'wash_volume',
        action: { type: 'response', text },
      });
      current = await stillBlocked(current);
    }
    current = await run<RecordEnvelope>(person, 'sops.answer_question', {
      sop: current.id,
      expectedVersion: current.version,
      question: 'wash_volume',
      action: {
        type: 'correct',
        text: 'Which working wash volume is scientifically supported?',
        reason: 'Clarify the decision',
      },
    });
    current = await stillBlocked(current);
    current = await run<RecordEnvelope>(person, 'records.update', {
      id: current.id,
      expectedVersion: current.version,
      attributes: {
        ...current.attributes,
        steps: (current.attributes as SopAttributes).steps.map((s) =>
          s.id === 'read' ? { ...s, title: 'Read absorbance' } : s,
        ),
      },
    });
    // A person's edit reviews its changed section; another confirm has no sections left to review.
    await expect(
      registry.execute(person, 'records.confirm', {
        id: current.id,
        expectedVersion: current.version,
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    current = await run<RecordEnvelope>(person, 'records.get', { id: current.id });
    current = await stillBlocked(current);
    expect((current.attributes as SopAttributes).questions?.[0]).toMatchObject({
      id: 'wash_volume',
      about: { step: 'wash' },
      stage: { stage: 'method' },
      disposition: { status: 'open' },
      responses: [{ text: "I don't know" }, { text: 'Use the 300 uL instruction' }],
    });
    expect((current.attributes as SopAttributes).steps[0]).toEqual(a.steps[0]);
  });

  it('does not infer undeclared missing settings from a bare wash action', async () => {
    // Existing readiness guards declared questions; it is not an action-completeness engine.
    const sop = await run<RecordEnvelope>(person, 'sops.draft', {
      label: 'Bare wash, no declared uncertainty',
      materials: [],
      variables: [],
      steps: [{ id: 'wash', action: 'wash', text: 'Wash the plate.' }],
    });
    const ready = await run<Readiness>(person, 'records.readiness', { id: sop.id });
    expect(ready.checks.some((c) => c.severity === 'blocker' && !c.passed)).toBe(false);
  });

  it('drafts an SOP whose readiness lists open questions and passes its formulas', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    expect(sop).toMatchObject({ kind: 'sop', name: 'SOP-0001', status: 'draft' });
    const ready = await run<Readiness>(person, 'records.readiness', { id: sop.id });
    const byId = new Map(ready.checks.map((c) => [c.id, c]));
    expect(byId.get('has_steps')?.passed).toBe(true);
    expect(byId.get('formulas_work')?.passed).toBe(true);
    expect(byId.get('timing_is_time')?.passed).toBe(true);
    expect(byId.get('questions_answered')).toMatchObject({ passed: false, severity: 'blocker' });
    expect(ready.sections.map((s) => s.id)).toEqual([
      'overview',
      'materials',
      'variables',
      'procedure',
      'layout',
      'analysis',
      'timing',
    ]);
  });

  it('flags a broken formula and a window that is not a time', async () => {
    const sop = await run<RecordEnvelope>(person, 'sops.draft', {
      ...elisa,
      variables: [
        ...elisa.variables.slice(0, -1),
        {
          name: 'diluent',
          label: 'Coating solution',
          kind: 'computed',
          expression: 'well_volume + 5 min',
        },
      ],
      timing: [{ step: 'read', max: q('30', 'uL'), source: 'vendor', enforce: true }],
      questions: [],
    });
    const ready = await run<Readiness>(person, 'records.readiness', { id: sop.id });
    const byId = new Map(ready.checks.map((c) => [c.id, c]));
    expect(byId.get('formulas_work')).toMatchObject({
      passed: false,
      message: "diluent: Can't add time to volume",
    });
    expect(byId.get('timing_is_time')).toMatchObject({
      passed: false,
      message: 'Not a time: step read',
    });
    expect(byId.get('questions_answered')?.passed).toBe(true);
  });

  it('flags a formula that uses a name no variable has', async () => {
    const sop = await run<RecordEnvelope>(person, 'sops.draft', {
      ...elisa,
      variables: [
        ...elisa.variables.slice(0, -1),
        {
          name: 'diluent',
          label: 'Coating solution',
          kind: 'computed',
          expression: 'missing_typo * 100 uL',
        },
      ],
      questions: [],
    });
    const ready = await run<Readiness>(person, 'records.readiness', { id: sop.id });
    expect(ready.checks.find((c) => c.id === 'formulas_work')).toMatchObject({
      passed: false,
      message: "diluent: Uses missing_typo, which isn't a declared variable",
    });
  });

  it('refuses unknown roles, variables, steps and units, and a record variable with no source', async () => {
    const refused = (input: unknown) => registry.execute(agent, 'sops.draft', input);
    await expect(
      refused({ ...elisa, steps: [{ ...elisa.steps[0], uses: ['nothing'] }] }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('uses nothing, which is not a material'),
    });
    await expect(
      refused({
        ...elisa,
        timing: [{ step: 'dry', max: q('1', 'h'), source: 'vendor', enforce: false }],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('step dry, which is not a step') });
    await expect(
      refused({
        ...elisa,
        variables: [
          ...elisa.variables,
          { name: 'x', label: 'X', kind: 'default', value: q('1', 'ul') },
        ],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('unknown unit "ul"') });
    await expect(
      refused({ ...elisa, variables: [{ name: 'c', label: 'C', kind: 'record', value: '1' }] }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      refused({
        ...elisa,
        variables: [...elisa.variables, { name: 'n_samples', label: 'Again', kind: 'input' }],
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('The variable n_samples is named twice'),
    });
  });
});

describe('sops.calculate', () => {
  it('works out the run from its inputs, saying where each value came from', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const out = await run<{ variables: Record<string, unknown>[] }>(agent, 'sops.calculate', {
      sop: sop.id,
      inputs: [{ name: 'n_samples', value: '10' }],
    });
    const byName = new Map(out.variables.map((v) => [v.name, v]));
    expect(byName.get('n_samples')).toMatchObject({ number: '10', from: 'input' });
    expect(byName.get('capture_conc')).toMatchObject({
      quantity: q('2', 'ug/mL'),
      from: 'typical',
    });
    expect(byName.get('diluent')).toMatchObject({ quantity: q('7', 'mL'), from: 'computed' });
  });

  it('refuses a variable it lacks, a formula given as input, and an SOP from another lab', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const calc = (ctx: RecordContext, inputs: unknown[]) =>
      registry.execute(ctx, 'sops.calculate', { sop: sop.id, inputs });
    await expect(calc(agent, [{ name: 'plates', value: '2' }])).rejects.toMatchObject({
      message: 'SOP-0001 has no variable plates',
    });
    await expect(calc(agent, [{ name: 'diluent', value: q('1', 'mL') }])).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(calc(otherLab, [])).rejects.toMatchObject({ code: 'not_found' });
  });

  it('holds inputs to their limits, units and one value each', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const calc = (inputs: unknown[]) =>
      registry.execute(agent, 'sops.calculate', { sop: sop.id, inputs });
    await expect(calc([{ name: 'n_samples', value: '41' }])).rejects.toMatchObject({
      message: 'n_samples: 41 is above the most allowed, 40',
    });
    await expect(calc([{ name: 'n_samples', value: '0' }])).rejects.toMatchObject({
      message: 'n_samples: 0 is below the least allowed, 1',
    });
    await expect(
      calc([
        { name: 'n_samples', value: '10' },
        { name: 'n_samples', value: '20' },
      ]),
    ).rejects.toMatchObject({ message: 'n_samples is given twice' });
    await expect(calc([{ name: 'well_volume', value: '50' }])).rejects.toMatchObject({
      message: 'well_volume needs a unit, like µL',
    });
    await expect(calc([{ name: 'well_volume', value: q('1', 'h') }])).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(calc([{ name: 'well_volume', value: q('1', 'furlong') }])).rejects.toMatchObject({
      message: 'well_volume: unknown unit "furlong"',
    });
    await expect(calc([{ name: 'n_samples', value: q('1', 'uL') }])).rejects.toMatchObject({
      message: 'n_samples is a plain number, without a unit',
    });
  });
});

describe('binding roles (012b)', () => {
  async function lab() {
    const product = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'product',
      label: 'IL-6 capture antibody',
      attributes: {
        category: 'antibody',
        origin: 'bought',
        lotFields: [
          {
            key: 'workingConcentration',
            label: 'Working concentration',
            unit: 'ug/mL',
            typical: q('2', 'ug/mL'),
          },
        ],
      },
    });
    const lot = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'lot',
      label: 'Lot 1234',
      attributes: {
        product: product.id,
        lotNumber: '1234',
        status: 'unopened',
        values: [{ field: 'workingConcentration', value: q('4', 'ug/mL') }],
      },
    });
    const plate = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'labware_type',
      label: 'High-bind 96',
      attributes: { family: 'plate', deadVolume: q('10', 'uL') },
    });
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', {
      label: 'Coating',
      materials: [
        { role: 'capture_ab', label: 'Capture antibody', type: 'reagent', default: product.id },
        { role: 'plate', label: 'Plate', type: 'labware', default: plate.id },
      ],
      variables: [
        { name: 'wells', label: 'Wells', kind: 'input', value: '96' },
        { name: 'well_volume', label: 'Well volume', kind: 'default', value: q('100', 'uL') },
        {
          name: 'capture_conc',
          label: 'Capture antibody working concentration',
          kind: 'record',
          value: q('1', 'ug/mL'),
          readFrom: { role: 'capture_ab', field: 'workingConcentration' },
        },
        {
          name: 'dead',
          label: 'Dead volume',
          kind: 'record',
          readFrom: { role: 'plate', field: 'deadVolume' },
        },
        {
          name: 'coating',
          label: 'Coating solution',
          kind: 'computed',
          expression: 'wells * (well_volume + dead)',
          unit: 'mL',
        },
      ],
      steps: [{ id: 'coat', action: 'add', text: 'Coat.', uses: ['plate', 'capture_ab'] }],
    });
    return { product, lot, plate, sop };
  }
  type Calculated = {
    bindings: Record<string, unknown>[];
    variables: Record<string, unknown>[];
  };
  const byName = (c: Calculated) => new Map(c.variables.map((v) => [v.name, v]));

  it('reads typical values from defaults and certificate values from a picked lot', async () => {
    const { sop, lot, product, plate } = await lab();
    const planned = await run<Calculated>(agent, 'sops.calculate', { sop: sop.id });
    expect(planned.bindings).toEqual([
      expect.objectContaining({ role: 'capture_ab', record: product.id, by: 'default' }),
      expect.objectContaining({ role: 'plate', record: plate.id, by: 'default' }),
    ]);
    expect(byName(planned).get('capture_conc')).toMatchObject({
      quantity: q('2', 'ug/mL'),
      from: 'typical',
      source: { record: product.id, field: 'workingConcentration' },
    });
    expect(byName(planned).get('dead')).toMatchObject({ quantity: q('10', 'uL'), from: 'record' });
    expect(byName(planned).get('coating')).toMatchObject({ quantity: q('10.56', 'mL') });

    const onTheDay = await run<Calculated>(person, 'sops.calculate', {
      sop: sop.id,
      bindings: [{ role: 'capture_ab', record: lot.id }],
      inputs: [{ name: 'wells', value: '48' }],
    });
    expect(byName(onTheDay).get('capture_conc')).toMatchObject({
      quantity: q('4', 'ug/mL'),
      from: 'record',
      source: { record: lot.id, name: lot.name },
    });
    expect(byName(onTheDay).get('coating')).toMatchObject({ quantity: q('5.28', 'mL') });
  });

  it('says when a record does not fit its role or lacks the field', async () => {
    const { sop, plate } = await lab();
    const wrong = await run<Calculated>(agent, 'sops.calculate', {
      sop: sop.id,
      bindings: [{ role: 'capture_ab', record: plate.id }],
    });
    expect(wrong.bindings[0]?.problem).toMatch(
      /is a labware type; Capture antibody needs a product or lot/,
    );
    expect(byName(wrong).get('capture_conc')).toMatchObject({
      quantity: q('1', 'ug/mL'),
      from: 'typical',
    });
    await expect(
      registry.execute(agent, 'sops.calculate', {
        sop: sop.id,
        bindings: [{ role: 'reader', record: plate.id }],
      }),
    ).rejects.toMatchObject({ message: 'SOP-0001 has no material reader' });

    const bare = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'labware_type',
      label: 'No dead volume',
      attributes: { family: 'plate' },
    });
    const noDead = await run<Calculated>(agent, 'sops.calculate', {
      sop: sop.id,
      bindings: [{ role: 'plate', record: bare.id }],
    });
    expect(byName(noDead).get('dead')).toMatchObject({
      ok: false,
      from: 'missing',
      problem: `${bare.name} has no deadVolume`,
    });
    expect(byName(noDead).get('coating')).toMatchObject({ ok: false, waitsOn: ['dead'] });
  });

  it('checks defaults in readiness', async () => {
    const { sop, plate } = await lab();
    const a = sop.attributes as { materials: { role: string }[] };
    const updated = await run<RecordEnvelope>(person, 'records.update', {
      id: sop.id,
      expectedVersion: sop.version,
      attributes: {
        ...(sop.attributes as object),
        materials: a.materials.map((m) =>
          m.role === 'capture_ab' ? { ...m, default: plate.id } : m,
        ),
      },
    });
    const ready = await run<Readiness>(person, 'records.readiness', { id: updated.id });
    expect(ready.checks.find((c) => c.id === 'materials_fit')).toMatchObject({
      passed: false,
      severity: 'blocker',
    });
  });
});

describe('scientific question lifecycle', () => {
  it('records unknown responses with actor, time and version without resolving the method', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const input = {
      sop: sop.id,
      expectedVersion: sop.version,
      question: 'q1',
      action: { type: 'response', text: "I don't know" },
    };
    await expect(registry.execute(agent, 'sops.answer_question', input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(registry.execute(otherLab, 'sops.answer_question', input)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      registry.execute(person, 'sops.answer_question', {
        ...input,
        action: { type: 'response', text: '  ' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      registry.execute(person, 'sops.answer_question', { ...input, question: 'missing' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const answered = await run<RecordEnvelope>(person, 'sops.answer_question', input);
    // A double click or retry after a lost HTTP response must not append another answer
    // against the version the person originally reviewed.
    await expect(registry.execute(person, 'sops.answer_question', input)).rejects.toMatchObject({
      code: 'version_conflict',
    });
    const reloaded = await run<RecordEnvelope>(person, 'records.get', { id: sop.id });
    expect(reloaded.version).toBe(answered.version);
    expect(reloaded.attributes).toEqual(answered.attributes);
    expect(answered.attributes.questions).toEqual([
      expect.objectContaining({
        id: 'q1',
        disposition: { status: 'open' },
        responses: [
          {
            text: "I don't know",
            by: person.actor,
            at: expect.any(String),
            version: answered.version,
          },
        ],
      }),
    ]);
    const readiness = await run<Readiness>(person, 'records.readiness', { id: sop.id });
    expect(readiness.checks.find((c) => c.id === 'questions_answered')).toMatchObject({
      passed: false,
      severity: 'blocker',
    });
    const partiallyConfirmed = await run<RecordEnvelope>(person, 'records.confirm', {
      id: sop.id,
      expectedVersion: answered.version,
    });
    expect(partiallyConfirmed.status).toBe('draft');
    await expect(
      registry.execute(person, 'records.activate', {
        id: sop.id,
        expectedVersion: partiallyConfirmed.version,
      }),
    ).rejects.toMatchObject({ code: 'not_ready' });
    const corrected = await run<RecordEnvelope>(person, 'sops.answer_question', {
      ...input,
      expectedVersion: partiallyConfirmed.version,
      reason: 'Record this edit',
      action: {
        type: 'correct',
        text: 'Which coating temperature does the method require?',
        reason: 'Clarify the wording',
      },
    });
    expect(corrected.attributes.questions).toEqual([
      expect.objectContaining({
        id: 'q1',
        disposition: { status: 'open' },
        responses: [
          {
            text: "I don't know",
            by: person.actor,
            at: expect.any(String),
            version: answered.version,
          },
        ],
        stage: elisa.questions[0]?.stage,
      }),
    ]);
    const history = await run<{ versions: { snapshot: RecordEnvelope; reason?: string }[] }>(
      person,
      'records.history',
      { id: sop.id },
    );
    expect(history.versions.find((v) => v.snapshot.version === corrected.version)?.reason).toBe(
      'Clarify the wording',
    );
    expect(
      history.versions.some(
        (v) => JSON.stringify(v.snapshot.attributes) === JSON.stringify(answered.attributes),
      ),
    ).toBe(true);
    expect(
      history.versions.some(
        (v) =>
          (v.snapshot.attributes.questions as { question: string }[])[0]?.question ===
          elisa.questions[0]?.question,
      ),
    ).toBe(true);
  });

  it('refuses every generic all-actor question rewrite, omission, creation and restore', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    expect(
      Object.keys(sop.evidence).some((key) => key === 'questions' || key.startsWith('/questions/')),
    ).toBe(false);
    expect(sop.evidence['/variables/well_volume']?.source).toBe('assumed');
    await expect(
      registry.execute(agent, 'sops.draft', {
        ...elisa,
        evidence: { '/questions/q1': { source: 'assumed' } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
    for (const ctx of [person, agent]) {
      for (const changed of [
        { ...sop.attributes, questions: [] },
        { ...sop.attributes, questions: undefined },
        {
          ...sop.attributes,
          questions: [
            { ...(sop.attributes.questions as object[])[0], question: 'Nothing to decide' },
          ],
        },
      ])
        await expect(
          registry.execute(ctx, 'records.update', {
            id: sop.id,
            expectedVersion: sop.version,
            attributes: changed,
          }),
        ).rejects.toMatchObject({
          code: 'invalid_attributes',
          message: expect.stringContaining('operation-owned'),
        });
      await expect(
        registry.execute(ctx, 'records.create', {
          kind: 'sop',
          label: 'Bypass',
          attributes: sop.attributes,
        }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
      await expect(
        registry.execute(ctx, 'changes.apply', {
          steps: [
            {
              operation: 'records.update',
              input: {
                id: sop.id,
                expectedVersion: sop.version,
                attributes: { ...sop.attributes, questions: [] },
              },
            },
          ],
        }),
      ).rejects.toThrow();
    }
    const answered = await run<RecordEnvelope>(person, 'sops.answer_question', {
      sop: sop.id,
      expectedVersion: sop.version,
      question: 'q1',
      action: { type: 'response', text: 'Check the vendor sheet' },
    });
    const proposal = sop.id.replace('sop_', 'prp_');
    await db.insert(proposals).values({
      id: proposal,
      orgId: person.orgId,
      labId: person.labId,
      operationId: 'records.update',
      input: {
        id: sop.id,
        expectedVersion: answered.version,
        attributes: { ...answered.attributes, questions: [] },
      },
      status: 'pending',
      proposedBy: agent.actor,
      proposedAt: new Date(),
    });
    expect(await run(person, 'proposals.approve', { id: proposal })).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_attributes' },
    });
    expect(
      (await run<RecordEnvelope>(person, 'records.get', { id: sop.id })).attributes.questions,
    ).toEqual(answered.attributes.questions);
    for (const ctx of [person, agent])
      await expect(
        registry.execute(ctx, 'records.restore', {
          id: sop.id,
          expectedVersion: answered.version,
          version: sop.version,
        }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
    const edited = await run<RecordEnvelope>(agent, 'records.update', {
      id: sop.id,
      expectedVersion: answered.version,
      attributes: { ...answered.attributes, purpose: 'Measure IL-6 in supernatants' },
    });
    expect(edited.attributes.questions).toEqual(answered.attributes.questions);
  });

  it('appends typed questions for either actor but refuses fabricated dispositions and duplicate identities', async () => {
    let sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    for (const [index, ctx] of [person, agent].entries()) {
      sop = await run<RecordEnvelope>(ctx, 'sops.ask_question', {
        sop: sop.id,
        expectedVersion: sop.version,
        question: {
          id: `new-${index}`,
          question: 'Which sealing instruction?',
          stage: { stage: 'method', reason: 'The source is incomplete' },
        },
      });
      expect(
        (sop.attributes.questions as { responses: unknown[]; disposition: object }[]).at(-1),
      ).toMatchObject({ responses: [], disposition: { status: 'open' } });
    }
    await expect(
      registry.execute(agent, 'sops.ask_question', {
        sop: sop.id,
        expectedVersion: sop.version,
        question: { ...elisa.questions[0], id: 'q1' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
    await expect(
      registry.execute(agent, 'sops.draft', {
        ...elisa,
        questions: [{ ...elisa.questions[0], disposition: { status: 'resolved' }, responses: [] }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      registry.execute(otherLab, 'sops.ask_question', {
        sop: sop.id,
        expectedVersion: sop.version,
        question: elisa.questions[0],
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('verifies stage bindings at creation and does not defer a source conflict or invented run check', async () => {
    const question = {
      id: 'count',
      about: { variable: 'n_samples' },
      question: 'How many samples?',
      stage: {
        stage: 'experiment',
        reason: 'Chosen for each experiment',
        binding: { type: 'input', variable: 'n_samples' },
      },
    };
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', { ...elisa, questions: [question] });
    const ready = await run<Readiness>(person, 'records.readiness', { id: sop.id });
    expect(ready.checks.find((c) => c.id === 'questions_answered')?.passed).toBe(true);
    expect(ready.checks.find((c) => c.id === 'later_stage_questions')?.passed).toBe(false);
    const missing = await run<{ obligations: { passed: boolean }[] }>(person, 'sops.calculate', {
      sop: sop.id,
    });
    expect(missing.obligations[0]?.passed).toBe(false);
    const filled = await run<{ obligations: { passed: boolean }[] }>(person, 'sops.calculate', {
      sop: sop.id,
      inputs: [{ name: 'n_samples', value: '24' }],
    });
    expect(filled.obligations[0]?.passed).toBe(true);
    const roleSop = await run<RecordEnvelope>(agent, 'sops.draft', {
      ...elisa,
      questions: [
        {
          id: 'reagent',
          question: 'Which capture antibody?',
          about: { material: 'capture_ab' },
          stage: {
            stage: 'experiment',
            reason: 'Chosen from available material',
            binding: { type: 'material_role', role: 'capture_ab' },
          },
        },
      ],
    });
    expect(
      (
        await run<{ obligations: { passed: boolean }[] }>(person, 'sops.calculate', {
          sop: roleSop.id,
        })
      ).obligations[0]?.passed,
    ).toBe(false);
    const product = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'product',
      label: 'Capture antibody',
      attributes: { category: 'antibody', origin: 'bought' },
    });
    expect(
      (
        await run<{ obligations: { passed: boolean }[] }>(person, 'sops.calculate', {
          sop: roleSop.id,
          bindings: [{ role: 'capture_ab', record: product.id }],
        })
      ).obligations[0]?.passed,
    ).toBe(true);
    for (const invalid of [
      { ...question, about: { step: 'wash', variable: 'n_samples' } },
      {
        ...question,
        stage: { ...question.stage, binding: { type: 'input', variable: 'well_volume' } },
      },
      {
        ...question,
        stage: {
          stage: 'run',
          reason: 'Ask later',
          binding: { type: 'run_check', check: 'invented' },
        },
      },
      {
        ...question,
        stage: {
          stage: 'run',
          reason: 'Ask later',
          binding: { type: 'input', variable: 'n_samples' },
        },
      },
    ])
      await expect(
        registry.execute(agent, 'sops.draft', { ...elisa, questions: [invalid] }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
    const broken = await run<RecordEnvelope>(agent, 'sops.draft', {
      ...elisa,
      variables: [
        ...elisa.variables,
        { name: 'broken', label: 'Broken', kind: 'computed', expression: 'missing + 1' },
      ],
      questions: [question],
    });
    expect(
      (await run<Readiness>(person, 'records.readiness', { id: broken.id })).checks.find(
        (c) => c.id === 'formulas_work',
      )?.passed,
    ).toBe(false);
  });

  it('preserves accepted historical snapshots while refusing edits and operational use of unsupported old questions', async () => {
    const sop = await run<RecordEnvelope>(person, 'sops.draft', { ...elisa, questions: [] });
    const accepted = await run<RecordEnvelope>(person, 'records.confirm', {
      id: sop.id,
      expectedVersion: sop.version,
    });
    for (const ctx of [person, agent])
      await expect(
        registry.execute(ctx, 'records.update', {
          id: sop.id,
          expectedVersion: accepted.version,
          attributes: { ...accepted.attributes, notes: 'Edit' },
        }),
      ).rejects.toMatchObject({
        code: 'invalid_state',
        message: expect.stringContaining('revision workflow'),
      });
    // A pre-existing working draft must not disguise its accepted history.
    await db.update(records).set({ status: 'draft' }).where(eq(records.id, sop.id));
    await expect(
      registry.execute(person, 'records.restore', {
        id: sop.id,
        expectedVersion: accepted.version,
        version: sop.version,
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(
      registry.execute(person, 'sops.answer_question', {
        sop: sop.id,
        expectedVersion: accepted.version,
        question: 'q1',
        action: { type: 'response', text: 'Reply' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(
      withReviewer(new PlaybackModel([])).execute(person, 'sops.review', {
        sop: sop.id,
        expectedVersion: accepted.version,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
      message: expect.stringContaining('revision workflow'),
    });
    const legacy = {
      ...accepted.attributes,
      questions: [
        { id: 'legacy', question: 'Which wash?', status: 'answered', answer: "I don't know" },
      ],
    };
    const snapshot = { ...accepted, attributes: legacy };
    await db.update(records).set({ attributes: legacy }).where(eq(records.id, sop.id));
    await db
      .update(recordVersions)
      .set({ snapshot })
      .where(
        and(eq(recordVersions.recordId, sop.id), eq(recordVersions.version, accepted.version)),
      );
    expect((await run<RecordEnvelope>(person, 'records.get', { id: sop.id })).attributes).toEqual(
      legacy,
    );
    const history = await run<{ versions: { version: number; snapshot: RecordEnvelope }[] }>(
      person,
      'records.history',
      { id: sop.id },
    );
    expect(history.versions.find((v) => v.version === accepted.version)?.snapshot).toEqual(
      snapshot,
    );
    await expect(
      registry.execute(person, 'sops.calculate', { sop: sop.id, version: accepted.version }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('unsupported question contract'),
    });
    expect(
      (await run<Readiness>(person, 'records.readiness', { id: sop.id })).checks.find(
        (c) => c.id === 'questions_answered',
      )?.passed,
    ).toBe(false);
  });
});

describe('sops.check_citations', () => {
  it('checks an explicitly selected edition and refuses wrong passage, case changes and missing passages', async () => {
    const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'elisa.md',
      mediaType: 'text/markdown',
      text: '# Coating\nCoat the plate overnight.\n\n# Reading\nRead within 30 minutes.',
    });
    const doc = await run<RecordEnvelope>(person, 'library.add', {
      label: 'Vendor ELISA sheet',
      type: 'sop',
      license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
      files: [{ file: file.id, role: 'original' }],
    });
    await run(person, 'library.parse', { document: doc.id });
    const { source } = await run<{ source: ExactSourceReference }>(person, 'library.read', {
      document: doc.id,
    });
    const { passages } = await run<{ passages: { id: string }[] }>(person, 'library.read', {
      source,
      section: 0,
    });
    const cite = { document: doc.id, passage: passages[0]?.id, quote: 'Coat the plate overnight.' };
    const input = {
      ...elisa,
      source: { document: doc.id, exact: source },
      steps: elisa.steps.map((s, i) => (i === 0 ? { ...s, cite: [cite] } : s)),
    };
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', input);
    expect(await run(agent, 'sops.check_citations', { sop: sop.id })).toMatchObject({
      sourceStatus: 'checked',
      matches: 1,
      problems: 0,
      citations: [{ result: 'matches', exact: { source, passage: cite.passage } }],
    });
    for (const bad of [
      { ...cite, quote: 'coat the plate overnight.' },
      { ...cite, quote: 'Read within 30 minutes.' },
      { ...cite, passage: 'missing' },
    ]) {
      await expect(
        run(agent, 'sops.draft', { ...input, steps: [{ ...elisa.steps[0], cite: [bad] }] }),
      ).rejects.toThrow();
    }
    await run(person, 'library.parse', { document: doc.id });
    expect(await run(agent, 'sops.check_citations', { sop: sop.id })).toMatchObject({
      sourceStatus: 'checked',
      matches: 1,
    });
    const links = await run<{ links: { toId: string; relation: string }[] }>(
      person,
      'records.links',
      { id: sop.id, direction: 'from' },
    );
    expect(links.links).toContainEqual(
      expect.objectContaining({ toId: doc.id, relation: 'digitized_from' }),
    );
    await expect(run(otherLab, 'sops.check_citations', { sop: sop.id })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('SOP solutions', () => {
  it('links a solution to its recipe, so the recipe draft stays while the SOP uses it', async () => {
    const recipe = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'product',
      label: 'Wash buffer',
      attributes: { category: 'buffer', origin: 'made' },
    });
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', {
      ...elisa,
      solutions: [
        { role: 'wash_buffer', label: 'Wash buffer', text: 'See recipe', recipe: recipe.id },
      ],
    });
    const links = await run<{ links: { fromId: string; relation: string }[] }>(
      person,
      'records.links',
      { id: recipe.id, direction: 'to' },
    );
    expect(links.links).toContainEqual(
      expect.objectContaining({ fromId: sop.id, relation: 'made_with' }),
    );
    const kept = await refused(
      run(person, 'records.delete_draft', { id: recipe.id, expectedVersion: recipe.version }),
    );
    expect(kept.message).toContain('linked from other records');
    const wrong = await refused(
      run(agent, 'sops.draft', {
        ...elisa,
        solutions: [
          {
            role: 'wash_buffer',
            label: 'Wash buffer',
            text: 'See recipe',
            recipe: sop.id.replace('sop_', 'prd_'),
          },
        ],
      }),
    );
    expect(wrong.message).toContain('is not a product in this lab');
  });
});

/** A reviewer that plays back one turn per call, and keeps what it was sent. */
class PlaybackModel implements ChatModel {
  readonly provider = 'test';
  readonly model = 'reviewer';
  readonly requests: ModelRequest[] = [];
  constructor(readonly turns: (ModelTurn | Error)[]) {}
  async complete(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(structuredClone(request));
    const turn = this.turns.shift() ?? { text: 'Nothing more.', toolCalls: [], stop: 'end' };
    if (turn instanceof Error) throw turn;
    return turn;
  }
}

const call = (name: string, input: Record<string, unknown>, id = name): ModelTurn => ({
  text: '',
  toolCalls: [{ id, name, input }],
  stop: 'tool_use',
});

function withReviewer(model: ChatModel | undefined) {
  return createRegistry(
    db,
    kinds,
    new ActivityBus(),
    new Assistant(model ? { model, agentName: 'Test' } : { reason: 'No model' }),
    { files: registry.deps.files, converter },
  );
}

describe('sops.review', () => {
  it('continues commentary without claiming a clean review and bounds repeated commentary', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const raw = { output: [{ type: 'message', phase: 'commentary' }] };
    const model = new PlaybackModel([
      { text: 'Checking the source.', toolCalls: [], stop: 'continue', raw },
      call('sop_finish', { summary: 'Checked the source.' }),
    ]);
    const result = await withReviewer(model).execute(person, 'sops.review', {
      sop: sop.id,
      expectedVersion: 1,
    });
    expect((result as { output: unknown }).output).toMatchObject({
      stopped: 'clean',
      rounds: [{ summary: 'Checked the source.' }],
    });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages.at(-1)).toMatchObject({ role: 'assistant', raw });

    const looping = new PlaybackModel(
      Array.from({ length: 9 }, () => ({ text: 'Checking.', toolCalls: [], stop: 'continue' })),
    );
    const exhausted = await withReviewer(looping).execute(person, 'sops.review', {
      sop: sop.id,
      expectedVersion: 1,
    });
    expect(looping.requests).toHaveLength(8);
    expect((exhausted as { output: unknown }).output).toMatchObject({
      stopped: 'failed',
      rounds: [],
      problem: expect.stringContaining('did not finish'),
    });
  });

  it.each(['refusal', 'max_tokens'] as const)(
    'rejects scientific changes from a %s review turn',
    async (stop) => {
      const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
      const model = new PlaybackModel([
        {
          ...call('sop_fix', {
            path: '/steps/0/title',
            value: 'Must not change',
            reason: 'Seems right',
          }),
          text: 'Checked.',
          stop,
        },
      ]);
      const result = await withReviewer(model).execute(person, 'sops.review', {
        sop: sop.id,
        expectedVersion: 1,
      });
      expect((result as { output: unknown }).output).toMatchObject({
        stopped: 'failed',
        rounds: [],
      });
      expect(model.requests).toHaveLength(1);
      expect(await run<RecordEnvelope>(person, 'records.get', { id: sop.id })).toMatchObject({
        version: 1,
        attributes: sop.attributes,
      });
    },
  );

  it('fixes what the source settles, asks where it is unclear, keeps each round, and stops when clean', async () => {
    const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'elisa.md',
      mediaType: 'text/markdown',
      text: '# Washing\nWash 3 times with 300 uL wash buffer per well.\n\n# Reading\nRead at 450 nm within 30 minutes.',
    });
    const doc = await run<RecordEnvelope>(person, 'library.add', {
      label: 'Vendor ELISA sheet',
      type: 'sop',
      license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
      files: [{ file: file.id, role: 'original' }],
    });
    await run(person, 'library.parse', { document: doc.id });
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', {
      ...elisa,
      source: {
        document: doc.id,
        exact: (
          await run<{ source: ExactSourceReference }>(person, 'library.read', { document: doc.id })
        ).source,
      },
    });
    const { passages: washing } = await run<{ passages: { id: string }[] }>(
      person,
      'library.read',
      { document: doc.id, section: 0 },
    );
    const model = new PlaybackModel([
      {
        text: 'Checking the wash.',
        toolCalls: [
          {
            id: 'a',
            name: 'sop_fix',
            input: {
              path: '/steps/1/parameters/0/quantity',
              value: q('300', 'uL'),
              reason: 'The source says 300 uL per wash',
              cite: {
                document: doc.id,
                passage: washing[0]?.id,
                quote: 'Wash 3 times with 300 uL wash buffer per well.',
              },
            },
          },
          {
            id: 'b',
            name: 'sop_fix',
            input: { path: '/questions/0/status', value: 'answered', reason: 'Settled' },
          },
          {
            id: 'c',
            name: 'sop_fix',
            input: { path: '/steps/1/uses/0', value: 'nothing', reason: 'Try a bad role' },
          },
        ],
        stop: 'tool_use',
      },
      call('sop_ask', {
        question: 'Read within 30 minutes of the stop solution or of the last wash?',
        suggestion: 'Of the stop solution',
        about: { step: 'read' },
      }),
      call('sop_finish', { summary: 'Fixed the wash volume; asked about the read window.' }),
      // Round 2: nothing more to change.
      { text: 'All good.', toolCalls: [], stop: 'end' },
    ]);
    const reviewing = withReviewer(model);
    const result = await reviewing.execute(agent, 'sops.review', {
      sop: sop.id,
      expectedVersion: sop.version,
    });
    expect(result.status).toBe('done');
    const out = (result as { output: unknown }).output as {
      sop: RecordEnvelope;
      rounds: {
        round: number;
        findings: { type: string; path: string; before?: unknown }[];
        refused: { problem: string }[];
        toVersion?: number;
        summary?: string;
      }[];
      stopped: string;
    };
    expect(out.stopped).toBe('clean');
    expect(out.rounds).toHaveLength(2);
    const [first, second] = out.rounds;
    expect(first?.findings.map((f) => [f.type, f.path])).toEqual([
      ['fix', '/steps/1/parameters/0/quantity'],
      ['question', '/questions/1'],
    ]);
    expect(first?.findings[0]?.before).toEqual(q('400', 'uL'));
    expect(first?.refused.map((r) => r.problem)).toEqual([
      expect.stringContaining('sop_ask'),
      expect.stringContaining('uses nothing'),
    ]);
    expect(first?.summary).toContain('wash volume');
    expect(second?.findings).toEqual([]);
    expect(second?.toVersion).toBeUndefined();
    expect(model.requests[0]?.messages[0]).toMatchObject({
      role: 'user',
      text: expect.stringContaining('Wash 3 times with 300 uL'),
    });

    const a = out.sop.attributes as typeof elisa;
    expect(a.steps[1]?.parameters[0]).toEqual({ name: 'volume', quantity: q('300', 'uL') });
    expect(out.sop.version).toBe(sop.version + 1);
    expect(out.sop.evidence?.steps?.source).toBe('assumed');
    expect(out.sop.evidence?.['/steps/wash']).toMatchObject({
      source: 'stated',
      by: { type: 'agent', agentName: 'Test (reviewer)' },
    });
    const ready = await run<Readiness>(person, 'records.readiness', { id: sop.id });
    expect(ready.checks.find((c) => c.id === 'questions_answered')?.message).toContain(
      'stop solution',
    );
    const kept = await run<{ rounds: unknown[] }>(person, 'sops.reviews', { sop: sop.id });
    expect(kept.rounds).toEqual(out.rounds);
    await expect(run(otherLab, 'sops.reviews', { sop: sop.id })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('refuses without a model or on a stale version, and reports a failed model call', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    await expect(
      withReviewer(undefined).execute(person, 'sops.review', { sop: sop.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(
      withReviewer(new PlaybackModel([])).execute(person, 'sops.review', {
        sop: sop.id,
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      withReviewer(new PlaybackModel([])).execute(person, 'sops.review', {
        sop: sop.id,
        expectedVersion: 1,
        rounds: 9,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const failed = await withReviewer(new PlaybackModel([new Error('timed out')])).execute(
      person,
      'sops.review',
      { sop: sop.id, expectedVersion: 1 },
    );
    expect((failed as { output: unknown }).output).toMatchObject({
      stopped: 'failed',
      problem: expect.stringContaining('timed out'),
      rounds: [],
    });
  });
});

describe('sops.suggest', () => {
  const suggest = (model: ChatModel | undefined, ctx: RecordContext, input: unknown) =>
    withReviewer(model)
      .execute(ctx, 'sops.suggest', input)
      .then((r) => (r as { output: Record<string, unknown> }).output);

  it('continues commentary before a suggestion, and bounds commentary without parsing it', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const raw = { output: [{ type: 'message', phase: 'commentary' }] };
    const model = new PlaybackModel([
      {
        text: '{"kind":"default","value":"999","reason":"unfinished"}',
        toolCalls: [],
        stop: 'continue',
        raw,
      },
      call('sop_value', { kind: 'default', value: '50', reason: 'Source value' }),
    ]);
    expect(await suggest(model, person, { sop: sop.id, value: 'diluent' })).toMatchObject({
      variable: { value: '50' },
    });
    expect(model.requests[1]?.messages.at(-1)).toMatchObject({ role: 'assistant', raw });
    const looping = new PlaybackModel(
      Array.from({ length: 3 }, () => ({ text: 'Checking.', toolCalls: [], stop: 'continue' })),
    );
    await expect(suggest(looping, person, { sop: sop.id, value: 'diluent' })).rejects.toMatchObject(
      { code: 'invalid_state', message: expect.stringContaining('did not finish') },
    );
    expect(looping.requests).toHaveLength(2);
  });

  it.each(['refusal', 'max_tokens'] as const)(
    'rejects a valid scientific suggestion from a %s turn',
    async (stop) => {
      const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
      const model = new PlaybackModel([
        {
          ...call('sop_value', { kind: 'default', value: '50', reason: 'Source value' }),
          text: 'Complete.',
          stop,
        },
      ]);
      await expect(suggest(model, person, { sop: sop.id, value: 'diluent' })).rejects.toMatchObject(
        {
          code: 'invalid_state',
          message: expect.stringContaining(stop === 'refusal' ? 'declined' : 'cut off'),
        },
      );
      expect(model.requests).toHaveLength(1);
    },
  );

  it('fills in a value, checked with the calculator, and sends a broken formula back', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const model = new PlaybackModel([
      call('sop_value', { kind: 'computed', expression: 'n_samples * nope', reason: 'guess' }),
      call('sop_value', {
        kind: 'computed',
        expression: 'n_samples * replicates * well_volume * 1.1 + dead_volume',
        unit: 'mL',
        reason: 'Every sample in replicate, 10% extra, plus the reservoir',
      }),
    ]);
    const out = await suggest(model, person, { sop: sop.id, value: 'diluent' });
    expect(out).toMatchObject({
      variable: {
        name: 'diluent',
        label: 'Coating solution',
        kind: 'computed',
        expression: 'n_samples * replicates * well_volume * 1.1 + dead_volume',
      },
      model: 'test/reviewer',
    });
    // The refused answer went back with its reason; the record is unchanged.
    expect(JSON.stringify(model.requests[1]?.messages.at(-1))).toContain('nope');
    const after = await run<RecordEnvelope>(person, 'records.get', { id: sop.id });
    expect(after.version).toBe(1);
  });

  it('fills a step from the SOP as edited, and writes a new step with a fresh id', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const edited = {
      ...sop.attributes,
      steps: [
        {
          id: 'coat',
          action: 'add',
          text: 'Add `well_volume` of capture antibody to the `coating_plate`.',
        },
      ],
    };
    const filled = await suggest(
      new PlaybackModel([
        call('sop_steps', {
          steps: [
            {
              id: 'other',
              action: 'add',
              text: 'Add `well_volume` of capture antibody to the `coating_plate`.',
              uses: ['coating_plate', 'capture_ab'],
              parameters: [{ name: 'volume', variable: 'well_volume' }],
            },
          ],
          reason: 'From the words',
        }),
      ]),
      agent,
      { sop: sop.id, attributes: edited, step: 'coat' },
    );
    expect(filled).toMatchObject({
      steps: [{ id: 'coat', parameters: [{ name: 'volume', variable: 'well_volume' }] }],
    });
    const added = await suggest(
      new PlaybackModel([
        call('sop_steps', {
          steps: [{ id: 'x', action: 'wash', text: 'Wash with `plate_washer`.' }],
          reason: 'x',
        }),
        call('sop_steps', {
          steps: [{ id: 'coat', action: 'wash', text: 'Wash 3 times with `wash_buffer`.' }],
          reason: 'The sentence',
        }),
      ]),
      person,
      { sop: sop.id, attributes: edited, newStep: 'wash three times' },
    );
    expect(added).toMatchObject({ steps: [{ id: 's2', action: 'wash' }] });
  });

  it('refuses without a model, a missing target, a source to draft from, or another lab', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    await expect(
      suggest(undefined, person, { sop: sop.id, value: 'diluent' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const model = new PlaybackModel([]);
    await expect(
      suggest(model, person, { sop: sop.id, value: 'diluent', step: 'coat' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(suggest(model, person, { sop: sop.id, value: 'nothing' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(suggest(model, person, { sop: sop.id, steps: true })).rejects.toMatchObject({
      code: 'invalid_state',
    });
    await expect(suggest(model, otherLab, { sop: sop.id, value: 'diluent' })).rejects.toMatchObject(
      { code: 'not_found' },
    );
    // A model that never answers usefully is reported, not guessed around.
    await expect(
      suggest(new PlaybackModel([]), person, { sop: sop.id, value: 'diluent' }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
      message: expect.stringContaining('No usable'),
    });
    // One answer and one retry, so a person in the editor isn't kept waiting on more.
    const wrong = () => call('sop_value', { kind: 'computed', expression: 'nope', reason: 'x' });
    const patient = new PlaybackModel([wrong(), wrong(), wrong()]);
    await expect(suggest(patient, person, { sop: sop.id, value: 'diluent' })).rejects.toMatchObject(
      { code: 'invalid_state', message: expect.stringContaining('nope') },
    );
    expect(patient.requests).toHaveLength(2);
  });
});

describe('the digitizing benchmark (sops.score)', () => {
  const expected = {
    key: 'elisa',
    document: 'Vendor ELISA sheet',
    basis: 'hand-checked',
    checked: true,
    materials: [
      { label: 'Capture antibody' },
      { label: 'Wash buffer', aliases: ['PBST'] },
      { label: 'Detection antibody' },
    ],
    steps: [
      { action: 'add', quantities: [q('100', 'uL')], words: ['capture'] },
      { action: 'wash', quantities: [q('400', 'uL')] },
      { action: 'read', quantities: [q('450', 'nm')] },
      { action: 'incubate', words: ['substrate'] },
    ],
    values: [{ quantity: q('5', 'mL'), about: 'dead volume' }, { quantity: q('30', 'min') }],
    questions: [{ about: 'coating temperature', words: ['4 °C'] }],
  };

  it('scores an SOP section by section, for a person and an agent, and says what is missing', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    for (const ctx of [person, agent]) {
      const score = await run<{
        materials: { recall: number; missing: string[] };
        steps: { recall: number; order: number; missing: string[] };
        values: { recall: number; missing: string[] };
        questions: { recall: number };
        overall: number;
      }>(ctx, 'sops.score', { sop: sop.id, expected });
      expect(score.materials).toMatchObject({ recall: 2 / 3, missing: ['Detection antibody'] });
      expect(score.steps).toMatchObject({ recall: 3 / 4, order: 1 });
      expect(score.steps.missing).toEqual(['incubate substrate']);
      // The 30 min window is on the timing rule, not a step or variable, so it is not found.
      expect(score.values).toMatchObject({ recall: 0.5, missing: ['30 min'] });
      expect(score.questions.recall).toBe(1);
      expect(score.overall).toBeCloseTo((2 / 3 + 3 / 4 + 0.5 + 1) / 4);
    }
  });

  it('refuses an expectation that is not one, a record that is not an SOP, and another lab', async () => {
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    await expect(
      registry.execute(person, 'sops.score', {
        sop: sop.id,
        expected: { ...expected, steps: [{ action: 'dance' }] },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      registry.execute(otherLab, 'sops.score', { sop: sop.id, expected }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('finds the SOPs drafted from each benchmark document and scores them before and after review', async () => {
    const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'elisa.md',
      mediaType: 'text/markdown',
      text: '# Coating\nCoat the plate overnight.',
    });
    const doc = await run<RecordEnvelope>(person, 'library.add', {
      label: 'Vendor ELISA sheet',
      type: 'sop',
      license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
      files: [{ file: file.id, role: 'original' }],
    });
    const sop = await run<RecordEnvelope>(agent, 'sops.draft', {
      ...elisa,
      source: {
        document: doc.id,
        exact: (
          await run<{ source: ExactSourceReference }>(person, 'library.read', { document: doc.id })
        ).source,
      },
      questions: [],
    });
    await run<RecordEnvelope>(agent, 'sops.draft', elisa);
    const reviewer = withReviewer(
      new PlaybackModel([
        call('sop_ask', {
          question: 'Overnight at 4 °C or at room temperature?',
          suggestion: 'At room temperature',
        }),
        call('sop_finish', { summary: 'One question' }),
        call('sop_finish', { summary: 'Nothing more' }),
      ]),
    );
    await reviewer.execute(person, 'sops.review', { sop: sop.id, expectedVersion: 1 });

    const rows = await runBenchmark(registry, person, [SopExpectation.parse(expected)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'elisa', sop: sop.name, draftedBy: 'Claude' });
    expect(rows[0]?.beforeReview?.questions?.recall).toBe(0);
    expect(rows[0]?.score.questions?.recall).toBe(1);
    expect(benchmarkTable(rows)).toContain(`| elisa | ${sop.name} IL-6 ELISA | Claude |`);
  });
});
