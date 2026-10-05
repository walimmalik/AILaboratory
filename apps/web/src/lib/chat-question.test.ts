import type { AssistantMessage, RecordEnvelope } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import {
  CONTINUE_QUESTION_MESSAGE,
  isResponseText,
  latestQuestionSelection,
  selectedQuestion,
  selectionForMessage,
} from './chat-question.ts';

const message: AssistantMessage = {
  role: 'user',
  id: 'msg_answer',
  at: '2026-10-05T12:00:00Z',
  text: "I don't know",
  page: {
    path: '/records/sop_selected',
    record: { id: 'sop_selected', name: 'SOP-0001', version: 7 },
    activeQuestion: { id: 'wash', stage: 'method' },
  },
};
describe('persisted human question context', () => {
  it('selects only a latest human context and does not infer it from an assistant or general follow-up', () => {
    const reply: AssistantMessage = {
      role: 'assistant',
      id: 'reply',
      at: message.at,
      text: 'Use 300 uL',
      toolCalls: [],
      model: 'test',
    };
    expect(latestQuestionSelection([message, reply], 'cnv_a')).toMatchObject({
      context: { record: { id: 'sop_selected', version: 7 }, activeQuestion: { id: 'wash' } },
      replyTo: { conversation: 'cnv_a', message: message.id },
    });
    expect(
      latestQuestionSelection(
        [message, { ...message, id: 'other', page: { path: '/inventory' } }],
        'cnv_a',
      ),
    ).toBeUndefined();
    expect(latestQuestionSelection([], 'cnv_new')).toBeUndefined();
    expect(selectionForMessage(reply, 'cnv_a')).toBeUndefined();
    expect(isResponseText(reply)).toBe(false);
  });
  it('allows unknown human text while excluding generated messages and attachments', () => {
    expect(isResponseText(message)).toBe(true);
    expect(
      isResponseText({
        ...message,
        text: 'Help me clarify this question in Earlier label: Earlier question',
      }),
    ).toBe(false);
    expect(isResponseText({ ...message, text: CONTINUE_QUESTION_MESSAGE })).toBe(false);
    expect(
      isResponseText({
        ...message,
        attachments: [
          { id: 'file_a', name: 'answer.txt', mediaType: 'text/plain', text: '300 uL' },
        ],
      }),
    ).toBe(false);
  });
  it('does not retarget an answer when the stage, record or question changes', () => {
    const selection = selectionForMessage(message, 'cnv_a');
    if (!selection) throw new Error('Missing fixture context');
    const record = {
      id: 'sop_selected',
      kind: 'sop',
      attributes: {
        materials: [],
        variables: [],
        steps: [],
        questions: [
          {
            id: 'wash',
            question: 'What wash volume?',
            stage: { stage: 'method', reason: 'Missing' },
            responses: [],
            disposition: { status: 'open' },
          },
        ],
      },
    } as unknown as RecordEnvelope;
    expect(selectedQuestion(record, selection)?.id).toBe('wash');
    expect(selectedQuestion({ ...record, id: 'sop_other' }, selection)).toBeUndefined();
    expect(
      selectedQuestion(record, {
        ...selection,
        context: { ...selection.context, activeQuestion: { id: 'wash', stage: 'run' } },
      }),
    ).toBeUndefined();
    expect(
      selectedQuestion(
        { ...record, attributes: { questions: [{ id: 'old', answer: 'settled' }] } },
        selection,
      ),
    ).toBeUndefined();
  });
});
