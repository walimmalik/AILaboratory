import type {
  AssistantMessage,
  PageContext,
  RecordEnvelope,
  ScientificQuestion,
} from '@ailab/schema';
import { currentQuestions } from './sop-questions.ts';

export interface QuestionSelection {
  context: {
    record: NonNullable<PageContext['record']>;
    activeQuestion: NonNullable<PageContext['activeQuestion']>;
  };
  replyTo?: { conversation: string; message: string };
}
export const CONTINUE_QUESTION_MESSAGE =
  'Continue helping me clarify this question using its recorded responses.';

/** Only the last persisted human turn selects follow-up context; never infer it from prose/tools. */
export function latestQuestionSelection(messages: AssistantMessage[], conversation: string) {
  const message = messages.findLast((entry) => entry.role === 'user');
  return message?.role === 'user' ? selectionForMessage(message, conversation) : undefined;
}

export function selectionForMessage(
  message: AssistantMessage,
  conversation: string,
): QuestionSelection | undefined {
  if (message.role !== 'user' || !message.page?.record || !message.page.activeQuestion)
    return undefined;
  return {
    context: { record: message.page.record, activeQuestion: message.page.activeQuestion },
    replyTo: { conversation, message: message.id },
  };
}

export function isResponseText(message: AssistantMessage) {
  // This is the launcher's fixed wording, conservatively excluded even after label/question edits.
  return (
    message.role === 'user' &&
    Boolean(message.text.trim()) &&
    !message.attachments?.length &&
    !message.text.startsWith('Help me clarify this question in ') &&
    message.text !== CONTINUE_QUESTION_MESSAGE
  );
}

export function selectedQuestion(record: RecordEnvelope | undefined, selection: QuestionSelection) {
  if (!record || record.id !== selection.context.record.id || record.kind !== 'sop')
    return undefined;
  const question = currentQuestions(record)?.find(
    (item) => item.id === selection.context.activeQuestion.id,
  );
  return question?.stage.stage === selection.context.activeQuestion.stage ? question : undefined;
}

export function freshQuestionSelection(
  record: RecordEnvelope,
  question: ScientificQuestion,
  previous?: QuestionSelection,
): QuestionSelection {
  return {
    context: {
      record: { id: record.id, name: record.name, version: record.version },
      activeQuestion: { id: question.id, stage: question.stage.stage },
    },
    ...(previous?.replyTo ? { replyTo: previous.replyTo } : {}),
  };
}
