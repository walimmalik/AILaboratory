import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { sopKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

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
  const kinds = new KindRegistry();
  for (const kind of [...labwareKinds, ...reagentKinds, ...fileKinds, ...libraryKinds, ...sopKinds])
    kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus());
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
      status: 'open',
    },
  ],
};

describe('sops.draft', () => {
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
      'questions',
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
