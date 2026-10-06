import type { RecordEnvelope, SopAttributes } from '@ailab/schema';
import type { Assistant } from '../assistant/assistant.ts';
import type { Db } from '../db/client.ts';
import { sop } from '../sops/kinds.ts';
import { defaultDecisionFixture } from './test-sop-default.ts';

export async function materialDecisionFixture(
  db: Db,
  method: typeof sop = sop,
  assistant?: Assistant,
) {
  const f = await defaultDecisionFixture(db, method, assistant);
  let target = await f.draft({
    ...f.target.attributes,
    materials: [
      ...f.target.attributes.materials,
      {
        role: 'plate',
        label: 'Assay plate',
        type: 'labware',
        requirements: '96 wells, high protein binding; compatibility requires review.',
        cite: [{ document: f.document.id, quote: 'Use a high binding assay plate.' }],
      },
    ],
    questions: [
      {
        id: 'plate',
        question: 'Which assay plate will this experiment use?',
        about: { material: 'plate' },
        stage: {
          stage: 'experiment',
          reason: 'Chosen for each experiment',
          binding: { type: 'material_role', role: 'plate' },
        },
        responses: [],
        disposition: { status: 'open' },
      },
    ],
  });
  const response = await f.registry.execute(f.person, 'sops.answer_question', {
    sop: target.id,
    expectedVersion: target.version,
    question: 'plate',
    action: { type: 'response', text: 'The experiment owner must choose and review it.' },
  });
  if (response.status !== 'done') throw new Error('Expected response');
  target = response.output as RecordEnvelope<SopAttributes>;
  return {
    ...f,
    target,
    input: {
      sop: target.id,
      expectedVersion: target.version,
      question: 'plate',
      reason: 'Keep the material choice explicit for every experiment',
    },
  };
}
