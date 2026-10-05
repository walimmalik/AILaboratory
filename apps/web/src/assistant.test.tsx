import { assistantAsk, type Conversation, type RecordEnvelope } from '@ailab/schema';
import { Children, isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';
import { AssistantProvider, type useAssistant } from './assistant.tsx';
import { AssistantPanel, Composer } from './pages/AssistantPanel.tsx';

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  refCursor: 0,
  effects: [] as (() => void)[],
  conversation: undefined as Conversation | undefined,
  contextError: undefined as Error | undefined,
  refresh: vi.fn(),
  storage: '',
  shownRecord: { id: 'sop_OTHER', name: 'SOP-OTHER', version: 99 },
  assistant: undefined as ReturnType<typeof useAssistant> | undefined,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.values))
      fixture.values[index] = typeof initial === 'function' ? initial() : initial;
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
  useMemo: (build: () => unknown) => build(),
  useContext: () => fixture.assistant,
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => {
    fixture.effects.push(effect);
  },
}));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({
    data: fixture.conversation,
    error: fixture.contextError,
    refetch: fixture.refresh,
  }),
  useQueryClient: () => ({
    getQueryData: () => fixture.shownRecord,
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    cancelQueries: vi.fn().mockResolvedValue(undefined),
    setQueryData: vi.fn(),
  }),
}));
vi.mock('@tanstack/react-router', () => ({ useRouterState: () => '/records/sop_OTHER' }));
vi.mock('./api.ts', () => ({ api: { run: vi.fn(), subscribeConversation: vi.fn() } }));
const context = {
  record: { id: 'sop_selected', name: 'SOP-0001', version: 7 },
  activeQuestion: { id: 'wash', stage: 'method' as const },
};
function ui() {
  fixture.cursor = 0;
  fixture.refCursor = 0;
  fixture.effects = [];
  return AssistantProvider({ children: null }).props.value as ReturnType<typeof useAssistant>;
}
function composerKey() {
  fixture.assistant = ui();
  const composer = Children.toArray(AssistantPanel().props.children).find(
    (child) => isValidElement(child) && child.type === Composer,
  );
  if (!isValidElement(composer)) throw new Error('Missing panel composer');
  return composer.key;
}
beforeEach(() => {
  fixture.values = [];
  fixture.refs = [];
  fixture.cursor = 0;
  fixture.refCursor = 0;
  fixture.effects = [];
  fixture.storage = JSON.stringify({ open: true, conversationId: 'cnv_selected' });
  fixture.contextError = undefined;
  fixture.assistant = undefined;
  fixture.conversation = {
    id: 'cnv_selected',
    messages: [
      {
        id: 'msg_selected',
        role: 'user',
        at: '2026-10-05T12:00:00Z',
        text: 'Help me clarify this question in Plate wash: What volume?',
        page: { path: '/records/sop_selected', ...context },
      },
    ],
  } as unknown as Conversation;
  fixture.refresh.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('localStorage', {
    getItem: () => fixture.storage,
    setItem: (_key: string, value: string) => {
      fixture.storage = value;
    },
  });
  vi.stubGlobal('document', { querySelector: () => ({ textContent: 'Other SOP' }) });
  vi.mocked(api.run).mockReset().mockResolvedValue({ id: 'cnv_selected' });
});

describe('conversation-scoped question selection', () => {
  it('keeps the panel composer mounted when the first send gains an ID, but resets it for explicit switches', async () => {
    fixture.storage = JSON.stringify({ open: true });
    fixture.conversation = undefined;
    let finish: (value: { id: string }) => void = () => {};
    vi.mocked(api.run).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const initialKey = composerKey();
    const pending = ui().send('First request');
    expect(composerKey()).toBe(initialKey);
    finish({ id: 'cnv_created' });
    await pending;
    expect(ui().conversationId).toBe('cnv_created');
    // Same React identity retains newer unsent text/files while Composer clears only submitted ones.
    expect(composerKey()).toBe(initialKey);
    ui().show('cnv_other');
    const switchedKey = composerKey();
    expect(switchedKey).not.toBe(initialKey);
    ui().show();
    const newKey = composerKey();
    expect(newKey).not.toBe(switchedKey);
    // New also clears an unsent draft when no conversation has been created yet.
    ui().show();
    expect(composerKey()).not.toBe(newKey);
    const beforeFresh = composerKey();
    const freshPending = ui().send('Start a different task', { fresh: true });
    const freshKey = composerKey();
    expect(freshKey).not.toBe(beforeFresh);
    await freshPending;
    expect(composerKey()).toBe(freshKey);
  });

  it('sends the persisted selection after navigation instead of silently selecting the route record', async () => {
    const assistant = ui();
    expect(assistant.questionSelection?.context).toEqual(context);
    await assistant.send("I don't know");
    expect(api.run).toHaveBeenCalledWith(
      assistantAsk,
      expect.objectContaining({
        message: "I don't know",
        conversationId: 'cnv_selected',
        page: expect.objectContaining(context),
        replyTo: { conversation: 'cnv_selected', message: 'msg_selected' },
      }),
    );
    assistant.show();
    const fresh = ui();
    expect(fresh.questionSelection).toBeUndefined();
    await fresh.send('New request');
    const lastCall = vi.mocked(api.run).mock.calls.at(-1);
    if (!lastCall) throw new Error('Expected a fresh conversation request');
    expect(lastCall[1]).not.toHaveProperty('replyTo');
    expect((lastCall[1] as { page: unknown }).page).not.toHaveProperty('activeQuestion');
  });
  it('retains an explicit Clear across reload, without leaking it into another conversation', () => {
    ui().selectQuestion(undefined);
    expect(ui().questionSelection).toBeUndefined();
    fixture.effects[0]?.();
    fixture.values = [];
    fixture.refs = [];
    expect(ui().questionSelection).toBeUndefined();
    ui().show('cnv_other');
    fixture.conversation = { ...fixture.conversation, id: 'cnv_other' } as Conversation;
    expect(ui().questionSelection?.replyTo?.conversation).toBe('cnv_other');
  });
  it('blocks remembered-conversation sends while context loads or fails, while New remains usable', async () => {
    fixture.conversation = undefined;
    expect(ui().contextReady).toBe(false);
    expect(await ui().send('Too soon')).toBe(false);
    expect(api.run).not.toHaveBeenCalled();
    fixture.contextError = new Error('Context unavailable');
    expect(ui().contextError).toBe('Context unavailable');
    await ui().refreshContext();
    expect(fixture.refresh).toHaveBeenCalledOnce();
    ui().show();
    expect(ui().contextReady).toBe(true);
    expect(await ui().send('New request')).toBe(true);
  });
  it('advances only the still-selected acknowledged version and does not overwrite a newer choice', () => {
    const previous = ui().questionSelection;
    if (!previous) throw new Error('Missing selected question');
    const updated = {
      id: 'sop_selected',
      kind: 'sop',
      name: 'SOP-0001',
      version: 8,
      attributes: {
        materials: [],
        variables: [],
        steps: [],
        questions: [
          {
            id: 'wash',
            question: 'What volume?',
            stage: { stage: 'method', reason: 'Missing' },
            responses: [],
            disposition: { status: 'open' },
          },
        ],
      },
    } as unknown as RecordEnvelope;
    ui().acknowledgeResponse(previous, updated);
    expect(ui().questionSelection?.context.record.version).toBe(8);
    ui().acknowledgeResponse(previous, { ...updated, version: 9 });
    expect(ui().questionSelection?.context.record.version).toBe(8);
    const callback = ui().acknowledgeResponse;
    ui().selectQuestion(undefined);
    ui();
    callback(previous, updated);
    expect(ui().questionSelection).toBeUndefined();
  });
  it('does not switch back to an old conversation when an in-flight send completes', async () => {
    let finish: (value: { id: string }) => void = () => {};
    vi.mocked(api.run).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = ui();
    const pending = first.send('Follow up');
    first.show('cnv_other');
    finish({ id: 'cnv_selected' });
    await pending;
    expect(ui().conversationId).toBe('cnv_other');
  });
});
