import { type RecordEnvelope, sopsAnswerQuestion } from '@ailab/schema';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import type { QuestionSelection } from '../lib/chat-question.ts';
import { ChatQuestionResponse, SelectedQuestionContext } from './ChatQuestion.tsx';

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  refCursor: 0,
  record: undefined as RecordEnvelope | undefined,
  refetch: vi.fn(),
  invalidate: vi.fn(),
  onContinue: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.values)) fixture.values[index] = initial;
    return [
      fixture.values[index],
      (next: unknown) => {
        fixture.values[index] = typeof next === 'function' ? next(fixture.values[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = fixture.refCursor++;
    fixture.refs[index] ??= { current: initial };
    return fixture.refs[index];
  },
}));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({ data: fixture.record, isFetching: false, refetch: fixture.refetch }),
  useQueryClient: () => ({
    setQueryData: (_key: unknown, record: RecordEnvelope) => {
      fixture.record = record;
    },
    invalidateQueries: fixture.invalidate,
  }),
}));
vi.mock('../api.ts', () => ({ api: { run: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/record">{children}</a>,
}));
const selection: QuestionSelection = {
  context: {
    record: { id: 'sop_selected', name: 'SOP-0001', version: 7 },
    activeQuestion: { id: 'wash', stage: 'method' },
  },
  replyTo: { conversation: 'cnv_selected', message: 'msg_answer' },
};
function record(version = 7, response?: string): RecordEnvelope {
  return {
    id: 'sop_selected',
    kind: 'sop',
    name: 'SOP-0001',
    label: 'Plate wash',
    version,
    attributes: {
      materials: [],
      variables: [],
      steps: [],
      questions: [
        {
          id: 'wash',
          question: 'What wash volume?',
          stage: { stage: 'method', reason: 'Missing' },
          responses: response
            ? [
                {
                  text: response,
                  by: { type: 'user', userId: `usr_${'0'.repeat(26)}` },
                  at: '2026-10-05T12:00:00Z',
                  version,
                },
              ]
            : [],
          disposition: { status: 'open' },
        },
      ],
    },
  } as unknown as RecordEnvelope;
}
function tree(busy = false) {
  fixture.cursor = 0;
  fixture.refCursor = 0;
  return ChatQuestionResponse({
    selection,
    text: "I don't know",
    busy,
    onContinue: fixture.onContinue,
  });
}
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...nodes(child.props.children as ReactNode)]
      : [],
  );
}
function button(label: string, busy = false) {
  const found = nodes(tree(busy)).find(
    (node) => node.type === 'button' && node.props.children === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
async function click(label: string) {
  await (button(label).props.onClick as () => Promise<void>)();
  await vi.waitFor(() => expect(fixture.refs[0]?.current).toBe(false));
}
beforeEach(() => {
  fixture.values = [];
  fixture.refs = [];
  fixture.cursor = 0;
  fixture.refCursor = 0;
  fixture.record = record();
  fixture.invalidate.mockReset();
  fixture.refetch.mockReset().mockImplementation(async () => ({ data: fixture.record }));
  fixture.onContinue.mockReset().mockResolvedValue(true);
  vi.mocked(api.run).mockReset().mockResolvedValue(record(8, "I don't know"));
});
describe('explicit human chat responses', () => {
  it('shows the exact SOP target and keeps question-changing controls collapsed', () => {
    expect(renderToStaticMarkup(tree())).toContain('href="/record">Plate wash</a>');
    const context = SelectedQuestionContext({ selection, record: record(), onSelect: vi.fn() });
    const change = nodes(context).find(
      (node) =>
        node.type === 'details' &&
        nodes(node).some(
          (child) => child.type === 'summary' && child.props.children === 'Change question',
        ),
    );
    expect(change).toBeDefined();
    expect(change?.props.open).toBeUndefined();
    expect(nodes(change).some((node) => node.type === 'select')).toBe(true);
    expect(nodes(change).some((node) => node.props.children === 'Clear question')).toBe(true);
  });
  it('records unknown text exactly once against its captured version, preserving open status and refreshing related views', async () => {
    let complete: (value: RecordEnvelope) => void = () => {};
    vi.mocked(api.run).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const handler = button('Record response').props.onClick as () => Promise<void>;
    const pending = handler();
    await handler();
    expect(api.run).toHaveBeenCalledOnce();
    expect(button('Record response').props.disabled).toBe(true);
    complete(record(8, "I don't know"));
    await pending;
    expect(api.run).toHaveBeenCalledWith(sopsAnswerQuestion, {
      sop: 'sop_selected',
      question: 'wash',
      expectedVersion: 7,
      action: { type: 'response', text: "I don't know" },
    });
    expect(renderToStaticMarkup(tree())).toContain('The scientific issue remains open');
    expect(renderToStaticMarkup(tree())).toContain('Response recorded');
    expect(fixture.invalidate).toHaveBeenCalledWith({ queryKey: ['record', 'sop_selected'] });
    expect(button('Continue with assistant').props.disabled).toBe(false);
  });
  it('requires explicit current-question review before saving a stale captured response', async () => {
    fixture.record = record(9);
    expect(button('Review current question').props.disabled).toBe(false);
    expect(nodes(tree()).some((node) => node.props.children === 'Record response')).toBe(false);
    await click('Review current question');
    await click('Record response');
    expect(api.run).toHaveBeenCalledWith(
      sopsAnswerQuestion,
      expect.objectContaining({ expectedVersion: 9 }),
    );
  });
  it('refetches after a lost success, recognizes saved provenance without claiming a message receipt, and never writes it again', async () => {
    vi.mocked(api.run).mockImplementation(async () => {
      fixture.record = record(8, "I don't know");
      throw new Error('Lost HTTP response');
    });
    await click('Record response');
    expect(fixture.refetch).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(tree());
    expect(html).toContain('This answer is already recorded');
    expect(html).toContain(`usr_${'0'.repeat(26)}`);
    expect(html).toContain('does not identify which chat message recorded it');
    expect(html).not.toContain('Response recorded.</p>');
    await click('Review current question');
    await click('Continue with assistant');
    expect(api.run).toHaveBeenCalledOnce();
    expect(fixture.onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ record: expect.objectContaining({ version: 8 }) }),
      }),
    );
  });
  it('keeps a saved response when continuation fails and requires review if the question later changes', async () => {
    await click('Record response');
    fixture.onContinue.mockResolvedValue(false);
    await click('Continue with assistant');
    expect(renderToStaticMarkup(tree())).toContain('response stays recorded');
    expect(api.run).toHaveBeenCalledOnce();
    fixture.record = record(9, "I don't know");
    expect(button('Continue with assistant').props.disabled).toBe(true);
    await click('Review current question');
    await click('Continue with assistant');
    expect(api.run).toHaveBeenCalledOnce();
    expect(fixture.onContinue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ record: expect.objectContaining({ version: 9 }) }),
      }),
    );
  });
  it('does not allow busy writes or a disappeared/changed-stage question to acquire response authority', () => {
    expect(button('Record response', true).props.disabled).toBe(true);
    fixture.record = {
      ...record(),
      attributes: { materials: [], variables: [], steps: [], questions: [] },
    };
    expect(button('Record response').props.disabled).toBe(true);
  });
});
