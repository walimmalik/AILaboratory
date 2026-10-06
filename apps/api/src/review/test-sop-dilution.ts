import { readFile } from 'node:fs/promises';
import { newId } from '@ailab/domain';
import type {
  ExactSourceReference,
  PassageText,
  RecordEnvelope,
  SopAttributes,
} from '@ailab/schema';
import { createTenant } from '../auth.ts';
import { campaignKinds } from '../campaigns/kinds.ts';
import type { Db } from '../db/client.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { sopKinds } from '../sops/kinds.ts';

export async function dilutionDecisionFixture(db: Db) {
  const tenant = await createTenant(db, { orgName: 'Dilutions', labName: 'Lab', userName: 'A' });
  const person: RecordContext = {
    orgId: tenant.orgId,
    labId: tenant.labId,
    actor: { type: 'user', userId: tenant.userId },
  };
  const agent: RecordContext = {
    ...person,
    actor: { type: 'agent', agentName: 'Draft', onBehalfOf: tenant.userId },
    origin: { type: 'user_message', conversation: newId('cnv'), message: 'dilution-request' },
  };
  const kinds = new KindRegistry();
  for (const kind of [...fileKinds, ...libraryKinds, ...sopKinds, ...campaignKinds])
    kinds.register(kind);
  const bytes = new MemoryFileStore();
  let failure: 'missing' | 'corrupt' | undefined;
  const markdown = await readFile(
    new URL(
      '../../../../docs/sop-library/sops/igem-interlab-2022-exp1/labop-generated.md',
      import.meta.url,
    ),
    'utf8',
  );
  const quote = markdown.split('\n').find((line) => line.startsWith('7. Dilute')) as string;
  if (!quote) throw new Error('Actual source step seven missing');
  let text = quote;
  const bus = new ActivityBus();
  const registry = createRegistry(db, kinds, bus, undefined, {
    files: {
      put: (value) => bytes.put(value),
      get: (hash) =>
        failure === 'missing'
          ? Promise.resolve(undefined)
          : failure === 'corrupt'
            ? Promise.resolve(new TextEncoder().encode('corrupt'))
            : bytes.get(hash),
    },
    converter: {
      convert: async () => ({
        converter: 'test source line segmentation',
        warnings: ['Figures not converted'],
        sections: [{ heading: ['Protocol steps'], passages: [{ text }] }],
      }),
    },
  });
  const run = async <T>(ctx: RecordContext, operation: string, input: unknown) => {
    const r = await registry.execute(ctx, operation, input);
    if (r.status !== 'done') throw new Error(`Expected done ${operation}`);
    return r.output as T;
  };
  const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
    name: 'iGEM experiment1.md',
    mediaType: 'text/markdown',
    text: markdown,
  });
  const document = await run<RecordEnvelope>(person, 'library.add', {
    label: 'iGEM interlab 2022 experiment 1',
    type: 'sop',
    version: 'retained A',
    license: { name: 'Source terms not established; test use', sharePolicy: 'lab_private' },
    files: [{ file: file.id, role: 'original' }],
  });
  await run(person, 'library.parse', { document: document.id });
  const { source } = await run<{ source: ExactSourceReference }>(person, 'library.read', {
    document: document.id,
  });
  const { passages } = await run<{ passages: PassageText[] }>(person, 'library.read', {
    source,
    section: 0,
  });
  const passage = passages[0]?.id as string;
  const cite = { document: document.id, passage, quote };
  const attributes: SopAttributes = {
    notes: 'Unrelated note',
    source: { document: document.id, exact: source },
    materials: [],
    variables: [
      { name: 'final_volume', label: 'Final volume', kind: 'default', unit: 'mL' },
      { name: 'dilution_factor', label: 'Dilution factor', kind: 'default', value: '10' },
      {
        name: 'culture_volume',
        label: 'Culture volume',
        kind: 'computed',
        expression: 'final_volume / dilution_factor',
        unit: 'mL',
      },
      {
        name: 'lb_volume',
        label: 'LB volume',
        kind: 'computed',
        expression: 'final_volume - culture_volume',
        unit: 'mL',
      },
    ],
    steps: [
      {
        id: 'dilute',
        action: 'serial_dilute',
        text: quote,
        cite: [cite],
        parameters: [
          { name: 'final_volume', variable: 'final_volume' },
          { name: 'dilution_factor', variable: 'dilution_factor' },
          { name: 'sample_volume', variable: 'culture_volume' },
          { name: 'diluent_volume', variable: 'lb_volume' },
        ],
      },
    ],
    questions: [
      {
        id: 'final-volume',
        question: 'What final volume was omitted from this declared dilution?',
        about: { variable: 'final_volume', step: 'dilute' },
        stage: { stage: 'method', reason: 'Transcription omission' },
        passages: [cite],
        responses: [],
        disposition: { status: 'open' },
      },
    ],
  };
  const { questions, ...fields } = attributes;
  const target = await run<RecordEnvelope<SopAttributes>>(agent, 'sops.draft', {
    label: 'iGEM source-backed dilution',
    ...fields,
    questions: questions?.map(({ responses: _r, disposition: _d, ...q }) => q),
  });
  const service = new RecordService(db, kinds);
  const input = {
    type: 'dilution_final_volume' as const,
    sop: target.id,
    expectedVersion: target.version,
    question: 'final-volume',
    value: { value: '5', unit: 'mL' },
    passage,
    reason: 'Complete the retained source transcription',
  };
  return {
    db,
    registry,
    kinds,
    person,
    agent,
    bus,
    service,
    target,
    input,
    file,
    document,
    source,
    quote,
    run,
    fail: (value: typeof failure) => {
      failure = value;
    },
    reparse: async (value: string) => {
      text = value;
      return run(person, 'library.parse', { document: document.id, file: file.id });
    },
  };
}
