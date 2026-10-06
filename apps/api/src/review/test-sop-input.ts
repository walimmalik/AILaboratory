import type { RecordEnvelope, SopAttributes } from '@ailab/schema';
import type { Assistant } from '../assistant/assistant.ts';
import type { Db } from '../db/client.ts';
import { sop } from '../sops/kinds.ts';
import { defaultDecisionFixture } from './test-sop-default.ts';

/** Actual SOP kind, indirect validation reads and a retained unrelated method question. */
export async function inputDecisionFixture(db: Db, assistant?: Assistant) {
  const f = await defaultDecisionFixture(db, sop, assistant);
  let target = await f.draft({
    ...f.target.attributes,
    variables: [
      ...f.target.attributes.variables,
      { name: 'count', label: 'Sample count', kind: 'input', value: '1', min: '1', max: '100' },
    ],
    questions: [
      {
        id: 'count',
        question: 'How many samples?',
        about: { variable: 'count' },
        stage: {
          stage: 'experiment',
          reason: 'Chosen per experiment',
          binding: { type: 'input', variable: 'count' },
        },
        responses: [],
        disposition: { status: 'open' },
      },
      ...(f.target.attributes.questions ?? []),
    ],
  });
  const response = await f.registry.execute(f.person, 'sops.answer_question', {
    sop: target.id,
    expectedVersion: target.version,
    question: 'count',
    action: { type: 'response', text: 'The experiment owner will choose.' },
  });
  if (response.status !== 'done') throw new Error('Expected response');
  target = response.output as RecordEnvelope<SopAttributes>;
  return {
    ...f,
    target,
    input: {
      sop: target.id,
      expectedVersion: target.version,
      question: 'count',
      reason: 'Keep sample count explicit for every experiment',
    },
  };
}
