import { newId } from '@ailab/domain';
import type { RecordEnvelope, SopAttributes } from '@ailab/schema';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { sop } from '../sops/kinds.ts';

export async function defaultDecisionFixture(db: Db, method: typeof sop = sop) {
  const tenant = await createTenant(db, { orgName: 'Decisions', labName: 'Lab', userName: 'Wali' });
  const person: RecordContext = {
    actor: { type: 'user', userId: tenant.userId },
    orgId: tenant.orgId,
    labId: tenant.labId,
  };
  const agent: RecordContext = {
    ...person,
    actor: { type: 'agent', agentName: 'Test', onBehalfOf: tenant.userId },
    origin: { type: 'user_message', conversation: newId('cnv'), message: 'request-one' },
  };
  const kinds = new KindRegistry();
  for (const kind of [...labwareKinds, ...reagentKinds, ...libraryKinds, method])
    kinds.register(kind);
  const bus = new ActivityBus();
  const registry = createRegistry(db, kinds, bus);
  const service = new RecordService(db, kinds);
  const product = await service.create(agent, {
    kind: 'product',
    label: 'Antibody',
    attributes: {
      category: 'antibody',
      origin: 'bought',
      lotFields: [
        {
          key: 'concentration',
          label: 'Concentration',
          unit: 'ug/mL',
          typical: { value: '2', unit: 'ug/mL' },
        },
      ],
    },
  });
  const lot = await service.create(agent, {
    kind: 'lot',
    label: 'Lot A',
    attributes: { product: product.id, lotNumber: 'A', status: 'unopened', values: [] },
  });
  const document = await service.create(agent, {
    kind: 'document',
    label: 'Source',
    attributes: { type: 'sop', files: [], license: { name: 'CC0', sharePolicy: 'shareable' } },
  });
  const draft = async (attributes: SopAttributes) => {
    const result = await registry.execute(agent, 'sops.draft', {
      label: 'Coating',
      ...attributes,
      questions: attributes.questions?.map(
        ({ responses: _responses, disposition: _disposition, ...q }) => q,
      ),
    });
    if (result.status !== 'done') throw new Error('Expected the draft');
    return result.output as RecordEnvelope<SopAttributes>;
  };
  let target = await draft({
    notes: 'Original notes',
    source: { document: document.id },
    materials: [{ role: 'antibody', label: 'Antibody', type: 'reagent', default: lot.id }],
    variables: [
      {
        name: 'well_volume',
        label: 'Well volume',
        kind: 'default',
        value: { value: '100', unit: 'uL' },
      },
      {
        name: 'wash_volume',
        label: 'Wash volume',
        kind: 'default',
        value: { value: '300', unit: 'uL' },
      },
      {
        name: 'concentration',
        label: 'Concentration',
        kind: 'record',
        value: { value: '2', unit: 'ug/mL' },
        readFrom: { role: 'antibody', field: 'concentration' },
      },
    ],
    steps: [
      {
        id: 'coat',
        action: 'manual',
        text: 'Coat the plate.',
        uses: ['antibody'],
        cite: [{ document: document.id, quote: 'Coat the plate.' }],
      },
    ],
    questions: [
      {
        id: 'temperature',
        question: 'Which temperature?',
        about: { step: 'coat' },
        stage: { stage: 'method', reason: 'Source unclear' },
        responses: [],
        disposition: { status: 'open' },
      },
    ],
  });
  target = (await service.update(agent, target.id, {
    expectedVersion: target.version,
    evidence: {
      '/variables/well_volume': { source: 'datasheet', reference: 'Unchecked draft note' },
    },
  })) as RecordEnvelope<SopAttributes>;
  const edit = {
    sop: target.id,
    expectedVersion: target.version,
    variable: 'well_volume',
    value: { value: '80', unit: 'uL' },
    reason: 'Use the chosen planning default',
  };
  return {
    db,
    kinds,
    registry,
    service,
    bus,
    person,
    agent,
    product,
    lot,
    document,
    target,
    draft,
    edit,
  };
}
