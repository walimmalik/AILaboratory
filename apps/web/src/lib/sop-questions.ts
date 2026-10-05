import {
  type PageContext,
  type RecordEnvelope,
  type ScientificQuestion,
  SopAttributes,
} from '@ailab/schema';

/** Historical question payloads cannot establish whether a procedure is settled. */
export function currentQuestions(record: RecordEnvelope) {
  const parsed = SopAttributes.safeParse(record.attributes);
  return parsed.success ? (parsed.data.questions ?? []) : undefined;
}

export function stepQuestions(questions: ScientificQuestion[] | undefined, step: string) {
  return questions?.filter(
    (q) => q.about?.step === step && q.stage.stage === 'method' && q.disposition.status === 'open',
  );
}

/** Select a persisted question, retaining the precise version the person is reading. */
export function questionDiscussion(record: RecordEnvelope, id: string) {
  const question = currentQuestions(record)?.find((q) => q.id === id);
  if (!question) return undefined;
  return {
    message: `Help me clarify this question in ${record.label}: ${question.question}`,
    context: {
      record: { id: record.id, name: record.name, version: record.version },
      activeQuestion: { id: question.id, stage: question.stage.stage },
    } satisfies Pick<PageContext, 'record' | 'activeQuestion'>,
  };
}
