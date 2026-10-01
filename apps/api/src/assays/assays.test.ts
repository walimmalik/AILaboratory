import { readFileSync } from 'node:fs';
import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { plateMapKinds } from '../platemaps/kinds.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { sopKinds } from '../sops/kinds.ts';
import { assayKinds } from './kinds.ts';
import { readSeedAssayTemplates } from './seed.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let kinds: KindRegistry;
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
  kinds = new KindRegistry();
  for (const kind of [
    ...labwareKinds,
    ...instrumentKinds,
    ...reagentKinds,
    ...entityKinds,
    ...fileKinds,
    ...libraryKinds,
    ...sopKinds,
    ...plateMapKinds,
    ...assayKinds,
  ])
    kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus(), undefined, {
    files: new MemoryFileStore(),
  });
});
afterEach(() => close());

async function run<T = RecordEnvelope>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status !== 'done') throw new Error(`${id} was ${result.status}`);
  return result.output as T;
}

async function refused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeDefined();
  return error as OperationError;
}

/** A person confirms every section of a draft, which activates it. */
async function confirm(record: RecordEnvelope): Promise<RecordEnvelope> {
  let current = record;
  for (const section of kinds.get(record.kind).sections ?? []) {
    const state = await run<Readiness>(person, 'records.readiness', { id: current.id });
    if (state.sections.find((s) => s.id === section.id)?.state === 'confirmed') continue;
    current = await run(person, 'records.confirm_section', {
      id: current.id,
      expectedVersion: current.version,
      section: section.id,
    });
  }
  if (current.status === 'draft')
    current = await run(person, 'records.confirm', {
      id: current.id,
      expectedVersion: current.version,
    });
  return current;
}

const elisaSop = {
  label: 'IL-6 ELISA',
  materials: [
    { role: 'plate', label: 'Coating plate', type: 'labware' },
    { role: 'reader', label: 'Plate reader', type: 'instrument' },
  ],
  variables: [
    { name: 'sample_dilution', label: 'Sample dilution', kind: 'input', value: '1' },
    {
      name: 'well_volume',
      label: 'Well volume',
      kind: 'default',
      value: { value: '100', unit: 'uL' },
    },
  ],
  steps: [
    {
      id: 'read',
      action: 'read',
      text: 'Read absorbance at 450 nm.',
      uses: ['plate', 'reader'],
    },
  ],
};

async function setup() {
  const sop = await confirm(await run(agent, 'sops.draft', elisaSop));
  const layout = await confirm(
    await run(agent, 'layouts.draft', {
      label: 'ELISA 96',
      wells: 96,
      subjectRole: 'sample',
      replicates: 2,
      fixed: [
        { id: 'std', role: 'standard', region: ['A1:G2'] },
        { id: 'blank', role: 'blank', region: ['H1:H2'] },
      ],
    }),
  );
  const reader = await run(person, 'records.create', {
    kind: 'instrument_kind',
    label: 'Spark',
    attributes: { model: 'Spark', category: 'plate_reader', performedBy: 'machine' },
  });
  const template = {
    label: 'IL-6 ELISA',
    purpose: 'IL-6 in supernatants',
    assays: ['ELISA'],
    parts: [{ id: 'assay', sop: { id: sop.id, version: sop.version } }],
    layout: { id: layout.id, version: layout.version },
    roles: [
      {
        part: 'assay',
        role: 'reader',
        capability: 'read_absorbance',
        preferred: [reader.id],
      },
    ],
    essentials: [
      { input: 'subjects', id: 'samples', label: 'Which samples', max: 40 },
      {
        input: 'variable',
        id: 'dilution',
        label: 'Sample dilution',
        part: 'assay',
        variable: 'sample_dilution',
      },
    ],
    factors: [{ id: 'sample', label: 'Sample', from: 'samples' }],
    controls: [
      {
        id: 'std',
        label: 'IL-6 standard',
        role: 'standard',
        wells: 14,
        per: 'plate',
        reason: 'Curve',
      },
      { id: 'blank', label: 'Blank', role: 'blank', wells: 2, per: 'plate', reason: 'Background' },
    ],
    replicates: { technical: 2, reason: 'Duplicates' },
    readouts: [
      { id: 'od', label: 'Absorbance 450 nm', capability: 'read_absorbance', part: 'assay' },
    ],
  };
  return { sop, layout, reader, template };
}

const attributesOf = ({ label: _label, ...attributes }: Record<string, unknown>) => attributes;

describe('assay templates', () => {
  it('drafts a template that pins confirmed SOPs and a layout, and a person confirms it', async () => {
    const { sop, layout, reader, template } = await setup();
    const drafted = await run(agent, 'assays.draft_template', template);
    expect(drafted).toMatchObject({ kind: 'assay_template', name: 'ASY-0001', status: 'draft' });
    const state = await run<Readiness>(person, 'records.readiness', { id: drafted.id });
    expect(state.checks.filter((c) => !c.passed)).toEqual([]);
    const links = await run<{ links: { toId: string; relation: string }[] }>(
      person,
      'records.links',
      { id: drafted.id, direction: 'from' },
    );
    expect(links.links.map((l) => [l.relation, l.toId])).toEqual(
      expect.arrayContaining([
        ['follows', sop.id],
        ['layout', layout.id],
        ['prefers', reader.id],
      ]),
    );
    const overview = await run<{
      identity: { text: string }[];
      facts: { label: string; value: string }[];
    }>(person, 'records.overview', { id: drafted.id });
    expect(overview.identity.map((p) => p.text)).toEqual(['Assay template', 'for ELISA']);
    expect(overview.facts.map((f) => [f.label, f.value])).toEqual([
      ['measures', 'IL-6 in supernatants'],
      ['follows', 'IL-6 ELISA'],
      ['layout', 'ELISA 96'],
      ['asks for', 'Which samples, Sample dilution'],
      ['varies', 'Sample'],
      ['replicates', 'duplicates'],
      ['controls', 'IL-6 standard (14 wells per plate), Blank (2 wells per plate)'],
      ['reads', 'Absorbance 450 nm'],
    ]);
    const active = await confirm(drafted);
    expect(active.status).toBe('active');
    const found = await run<{ templates: { name: string; essentials: string[] }[] }>(
      agent,
      'assays.search',
      { assay: 'elisa', capability: 'read_absorbance' },
    );
    expect(found.templates).toEqual([
      expect.objectContaining({
        name: 'ASY-0001',
        essentials: ['Which samples', 'Sample dilution'],
      }),
    ]);
    expect(
      (
        await run<{ templates: unknown[] }>(agent, 'assays.search', {
          capability: 'read_luminescence',
        })
      ).templates,
    ).toEqual([]);
  });

  it('flags an unconfirmed SOP, and refuses roles, inputs and factors the template does not have', async () => {
    const { template } = await setup();
    const draftSop = await run(agent, 'sops.draft', { ...elisaSop, label: 'Draft ELISA' });
    const flagged = await run(agent, 'assays.draft_template', {
      ...template,
      parts: [{ id: 'assay', sop: { id: draftSop.id, version: draftSop.version } }],
    });
    const state = await run<Readiness>(person, 'records.readiness', { id: flagged.id });
    expect(state.checks.find((c) => c.id === 'sops_confirmed')).toMatchObject({
      passed: false,
      severity: 'blocker',
    });
    const message = async (changes: object) =>
      (await refused(run(agent, 'assays.draft_template', { ...template, ...changes }))).message;
    expect(
      await message({ roles: [{ part: 'assay', role: 'washer', capability: 'wash' }] }),
    ).toContain('has no material role washer');
    expect(
      await message({ roles: [{ part: 'seeding', role: 'reader', capability: 'wash' }] }),
    ).toContain('the template has no part seeding');
    expect(
      await message({
        essentials: [{ input: 'variable', id: 'x', label: 'X', part: 'assay', variable: 'nope' }],
      }),
    ).toContain('has no input or default variable nope');
    expect(
      await message({ factors: [{ id: 'sample', label: 'Sample', from: 'dilution' }] }),
    ).toContain('dilution is not a subjects input');
    expect(
      await message({
        readouts: [{ id: 'od', label: 'OD', capability: 'read_absorbance', part: 'x' }],
      }),
    ).toContain('the template has no part x');
    expect((await refused(run(otherLab, 'assays.draft_template', template))).message).toContain(
      'is not a digital SOP in this lab',
    );
  });

  it('works out missing inputs, conditions, wells and plates', async () => {
    const { template } = await setup();
    const saved = await run(agent, 'assays.draft_template', template);
    const waiting = await run<{ missing: { id: string }[]; conditions: number; lines: string[] }>(
      agent,
      'assays.design',
      { template: saved.id },
    );
    expect(waiting.missing.map((m) => m.id)).toEqual(['samples', 'dilution']);
    expect(waiting.conditions).toBe(0);
    expect(waiting.lines).toContain('Conditions and totals wait for the inputs above');

    const forty = await run<{
      missing: unknown[];
      conditions: number;
      totals: Record<string, number>;
      lines: string[];
    }>(agent, 'assays.design', { template: saved.id, answers: { samples: 40, dilution: '10' } });
    expect(forty.missing).toEqual([]);
    expect(forty.totals).toMatchObject({
      conditions: 40,
      subjectWells: 80,
      controlWells: 16,
      plates: 1,
      spare: 0,
    });
    expect(forty.lines.at(-1)).toBe('1 plate of 96 wells per run, 0 spare');

    const crossed = await run<{ conditions: number; listed: { label: string }[]; more: number }>(
      agent,
      'assays.design',
      {
        attributes: {
          ...attributesOf(template),
          factors: [
            { id: 'sample', label: 'Sample', from: 'samples' },
            {
              id: 'time',
              label: 'Time',
              levels: [
                { id: 'h24', label: '24 h' },
                { id: 'h48', label: '48 h' },
              ],
            },
          ],
        },
        answers: { samples: 3 },
        show: 2,
      },
    );
    expect(crossed.conditions).toBe(6);
    expect(crossed.listed.map((c) => c.label)).toEqual([
      'Sample: Subject 1 · Time: 24 h',
      'Sample: Subject 1 · Time: 48 h',
    ]);
    expect(crossed.more).toBe(4);

    expect(
      (await refused(run(agent, 'assays.design', { template: saved.id, answers: { samples: 41 } })))
        .message,
    ).toBe('Which samples: at most 40');
    expect(
      (
        await refused(
          run(agent, 'assays.design', { template: saved.id, answers: { dilution: ['x'] } }),
        )
      ).code,
    ).toBe('invalid_input');
    expect((await refused(run(otherLab, 'assays.design', { template: saved.id }))).code).toBe(
      'not_found',
    );
  });

  it('reads the seed templates with their records named by label', () => {
    const file = (name: string) =>
      readFileSync(new URL(`../../../../seed/${name}`, import.meta.url), 'utf8');
    const [elisa] = readSeedAssayTemplates(file('assay-templates.yaml'), {
      sops: new Map([['sop-elisa-il6', 'Human IL-6 sandwich ELISA (DuoSet), 96-well']]),
      layouts: file('layouts.yaml'),
      labware: file('labware.yaml'),
      instrumentLibrary: file('instrument-library.yaml'),
    });
    expect(elisa).toMatchObject({
      label: 'IL-6 sandwich ELISA',
      sops: [{ part: 'assay', label: 'Human IL-6 sandwich ELISA (DuoSet), 96-well' }],
      layout: 'IL-6 ELISA, 96 wells',
      preferred: [
        { role: 0, labels: ['Tecan Spark Cyto'] },
        { role: 1, labels: ['BlueCatBio BlueWasher'] },
      ],
      records: [{ role: 2, kind: 'labware_type' }],
    });
  });
});
