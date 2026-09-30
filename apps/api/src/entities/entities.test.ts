import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { entityKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  const kinds = new KindRegistry();
  for (const kind of [...labwareKinds, ...instrumentKinds, ...reagentKinds, ...entityKinds]) {
    kinds.register(kind);
  }
  registry = createRegistry(db, kinds, new ActivityBus());
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status === 'proposed') throw new Error(`${id} was proposed`);
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

async function confirmAll(record: RecordEnvelope, sections: string[]) {
  let current = record;
  for (const section of sections) {
    current = await run<RecordEnvelope>(person, 'records.confirm_section', {
      id: current.id,
      expectedVersion: current.version,
      section,
    });
  }
  return current;
}

const plasmidKind = {
  base: 'dna',
  prefix: 'PLS',
  fields: [
    { key: 'resistance', label: 'Resistance', type: { type: 'text' }, required: true },
    { key: 'length', label: 'Length', type: { type: 'number', unit: 'bp' } },
    {
      key: 'parent',
      label: 'Parent plasmid',
      type: { type: 'link', kind: 'entity' },
    },
  ],
};

async function plasmids() {
  const kind = await run<RecordEnvelope>(agent, 'entities.draft_kind', {
    label: 'Plasmid',
    attributes: plasmidKind,
  });
  return kind;
}

describe('entity kinds', () => {
  it('are drafted by an agent and confirmed by a person, with a prefix of their own', async () => {
    const kind = await plasmids();
    expect(kind).toMatchObject({ kind: 'entity_kind', status: 'draft', name: 'ENK-0001' });
    const active = await confirmAll(kind, ['definition', 'handling']);
    expect(active.status).toBe('active');

    const taken = await refused(
      run(agent, 'entities.draft_kind', {
        label: 'Plasmid again',
        attributes: { ...plasmidKind, fields: [] },
      }),
    );
    expect(taken.message).toContain('The prefix PLS is taken by Plasmid (ENK-0001)');
    const reserved = await refused(
      run(agent, 'entities.draft_kind', {
        label: 'Probe',
        attributes: { base: 'dna', prefix: 'PRD', fields: [] },
      }),
    );
    expect(reserved.message).toContain('The prefix PRD is taken by another registry');
    const repeated = await refused(
      run(agent, 'entities.draft_kind', {
        label: 'Oligo',
        attributes: {
          base: 'dna',
          prefix: 'OLI',
          fields: [
            { key: 'tm', label: 'Tm', type: { type: 'text' } },
            { key: 'tm', label: 'Tm again', type: { type: 'number', unit: 'parsecs' } },
          ],
        },
      }),
    );
    expect(repeated.message).toContain('Field keys tm appear twice');
    expect(repeated.message).toContain('"parsecs" is not a unit');
  });
});

describe('entities', () => {
  it('are named by their kind, checked against its fields, and confirmed once the kind is', async () => {
    const kind = await plasmids();
    const puc = await run<RecordEnvelope>(agent, 'entities.draft', {
      label: 'pUC19',
      entityKind: kind.id,
      fields: { length: { value: '2.686', unit: 'kb' } },
      sequence: { alphabet: 'dna', residues: 'TCGCGCGTTTCGGTGATGACGG', topology: 'circular' },
    });
    expect(puc).toMatchObject({ kind: 'entity', name: 'PLS-0001', status: 'draft' });

    const readiness = await run<Readiness>(person, 'records.readiness', { id: puc.id });
    const failing = readiness.checks.filter((c) => !c.passed).map((c) => c.message);
    expect(failing).toEqual(['Plasmid (ENK-0001) is still a draft', 'Resistance is required']);
    const confirmed = await confirmAll(puc, ['identity', 'handling']);
    expect(confirmed.status).toBe('draft');

    await confirmAll(kind, ['definition', 'handling']);
    const filled = await run<RecordEnvelope>(person, 'records.update', {
      id: puc.id,
      expectedVersion: confirmed.version,
      attributes: { ...confirmed.attributes, fields: { resistance: 'ampicillin' } },
    });
    const active = await confirmAll(filled, ['identity']);
    expect(active.status).toBe('active');

    const child = await run<RecordEnvelope>(agent, 'entities.draft', {
      label: 'pUC19 copy',
      entityKind: kind.id,
      fields: { resistance: 'ampicillin', parent: puc.id },
      sequence: { alphabet: 'dna', residues: 'tcgcgcgtttcggtgatgacgg', topology: 'circular' },
    });
    expect(child.name).toBe('PLS-0002');
    const childReadiness = await run<Readiness>(person, 'records.readiness', { id: child.id });
    expect(childReadiness.checks.find((c) => c.id === 'no_duplicate')).toMatchObject({
      passed: false,
      severity: 'warning',
      message: 'Same sequence as PLS-0001',
    });
    const links = await run<{ links: { toId: string; relation: string }[] }>(
      person,
      'records.links',
      { id: child.id, direction: 'from' },
    );
    expect(links.links.map((l) => l.relation).sort()).toEqual(['is_a', 'refers_to']);
  });

  it('refuses values that do not fit the kind, and a change of kind or prefix once used', async () => {
    const kind = await plasmids();
    const bad = await refused(
      run(agent, 'entities.draft', {
        label: 'Bad',
        entityKind: kind.id,
        fields: { resistance: 'amp', length: { value: '2', unit: 'mL' }, colour: 'blue' },
        sequence: { alphabet: 'dna', residues: 'ATGUX' },
        structure: { smiles: 'CCO' },
      }),
    );
    expect(bad.message).toContain('"colour" is not a field of this kind');
    expect(bad.message).toContain('Length: give it in a unit like bp, not mL');
    expect(bad.message).toContain('The sequence has U, X');
    expect(bad.message).toContain('A dna entity has no chemical structure');

    const vendor = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'vendor',
      label: 'NEB',
      attributes: {},
    });
    const wrongLink = await refused(
      run(agent, 'entities.draft', {
        label: 'Linked',
        entityKind: kind.id,
        fields: { parent: vendor.id },
      }),
    );
    expect(wrongLink.message).toContain(`Parent plasmid: ${vendor.name} is a vendor, not a entity`);

    const cells = await run<RecordEnvelope>(agent, 'entities.draft_kind', {
      label: 'Cell line',
      attributes: { base: 'cells', prefix: 'CEL', fields: [] },
    });
    const hek = await run<RecordEnvelope>(agent, 'entities.draft', {
      label: 'HEK293',
      entityKind: cells.id,
    });
    const moved = await refused(
      run(agent, 'records.update', {
        id: hek.id,
        expectedVersion: hek.version,
        attributes: { entityKind: kind.id, fields: {} },
      }),
    );
    expect(moved.message).toContain("An entity's kind can't change");
    const renamed = await refused(
      run(agent, 'records.update', {
        id: cells.id,
        expectedVersion: cells.version,
        attributes: { base: 'cells', prefix: 'CLL', fields: [] },
      }),
    );
    expect(renamed.message).toContain('Entities of this kind exist');
    const unknown = await refused(
      run(agent, 'entities.draft', {
        label: 'Orphan',
        entityKind: 'enk_01J9Z3K8Q4ABCDEFGHJKMNPQRS',
      }),
    );
    expect(unknown.message).toContain('is not an entity kind in this lab');
    await refused(run(agent, 'entities.draft', { label: 'No kind' }));
    const elsewhere = await refused(
      run(otherLab, 'entities.draft', { label: 'Theirs', entityKind: kind.id }),
    );
    expect(elsewhere.message).toContain('is not an entity kind in this lab');
    const agentActive = await refused(
      run(agent, 'records.create', {
        kind: 'entity',
        label: 'Straight in',
        status: 'active',
        attributes: { entityKind: cells.id, fields: {} },
      }),
    );
    expect(agentActive.message).toContain('An agent creates a entity as a draft');
  });

  it('are found by text, field, base and a stretch of sequence', async () => {
    const kind = await plasmids();
    const cells = await run<RecordEnvelope>(agent, 'entities.draft_kind', {
      label: 'Cell line',
      attributes: {
        base: 'cells',
        prefix: 'CEL',
        fields: [{ key: 'organism', label: 'Organism', type: { type: 'text' } }],
      },
    });
    const puc = await run<RecordEnvelope>(agent, 'entities.draft', {
      label: 'pUC19',
      entityKind: kind.id,
      fields: { resistance: 'ampicillin' },
      synonyms: ['pUC-19'],
      sequence: { alphabet: 'dna', residues: 'GGGATCCAAA', topology: 'circular' },
    });
    await run(agent, 'entities.draft', {
      label: 'HEK293',
      entityKind: cells.id,
      fields: { organism: 'Homo sapiens' },
    });
    type Found = { entities: { entity: RecordEnvelope; kind: { name: string } }[]; total: number };
    const ids = (f: Found) => f.entities.map((e) => e.entity.label);
    expect(ids(await run<Found>(agent, 'entities.search', { text: 'puc-19' }))).toEqual(['pUC19']);
    expect(ids(await run<Found>(agent, 'entities.search', { text: 'sapiens' }))).toEqual([
      'HEK293',
    ]);
    expect(ids(await run<Found>(agent, 'entities.search', { base: 'cells' }))).toEqual(['HEK293']);
    expect(
      ids(
        await run<Found>(agent, 'entities.search', {
          field: { key: 'resistance', value: 'ampicillin' },
        }),
      ),
    ).toEqual(['pUC19']);
    const bySequence = await run<Found>(agent, 'entities.search', { sequence: 'ttggatc' });
    expect(bySequence.entities).toEqual([
      expect.objectContaining({ entity: expect.objectContaining({ id: puc.id }) }),
    ]);
    expect(bySequence.entities[0]?.kind.name).toBe('ENK-0001');
    expect((await run<Found>(otherLab, 'entities.search', {})).total).toBe(0);
    await refused(run(agent, 'entities.search', { sequence: 'AT' }));
    await refused(run(agent, 'entities.search', { base: 'mineral' }));
  });
});
