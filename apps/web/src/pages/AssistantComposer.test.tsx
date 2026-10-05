import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './AssistantPanel.tsx';

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  ready: true,
  error: undefined as string | undefined,
  send: vi.fn(),
  refresh: vi.fn(),
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
  useRef: () => ({ current: null }),
}));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({ data: undefined, isFetching: false }),
}));
vi.mock('../assistant.tsx', () => ({
  useAssistant: () => ({
    sending: false,
    running: false,
    contextReady: fixture.ready,
    contextError: fixture.error,
    refreshContext: fixture.refresh,
    send: fixture.send,
  }),
}));
function render() {
  fixture.cursor = 0;
  return Composer();
}
function find(node: ReactNode, type: string): ReactElement<Record<string, unknown>> {
  if (isValidElement<Record<string, unknown>>(node)) {
    if (node.type === type) return node;
    for (const child of Children.toArray(node.props.children as ReactNode)) {
      try {
        return find(child, type);
      } catch {
        /* Try the next child. */
      }
    }
  }
  throw new Error(`Missing ${type}`);
}
function type(text: string) {
  const input = find(render(), 'textarea');
  (input.props.onChange as (event: unknown) => void)({ target: { value: text } });
}
async function submit() {
  await (render().props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
}
beforeEach(() => {
  fixture.values = [];
  fixture.ready = true;
  fixture.error = undefined;
  vi.clearAllMocks();
});
describe('assistant composer continuity', () => {
  it('preserves newer text while an earlier send completes, and clears unchanged text', async () => {
    let finish: ((result: boolean) => void) | undefined;
    fixture.send.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    type('Original response');
    const pending = submit();
    type('Newer response');
    finish?.(true);
    await pending;
    expect(find(render(), 'textarea').props.value).toBe('Newer response');
    expect(fixture.send).toHaveBeenCalledWith('Original response', { attachments: [] });
    fixture.send.mockResolvedValue(true);
    await submit();
    expect(find(render(), 'textarea').props.value).toBe('');
  });
  it('blocks submission until remembered conversation context loads, including load failure', async () => {
    type('A quick response');
    fixture.ready = false;
    await submit();
    fixture.error = 'Could not load conversation context';
    await submit();
    expect(fixture.send).not.toHaveBeenCalled();
    fixture.ready = true;
    fixture.error = undefined;
    fixture.send.mockResolvedValue(true);
    await submit();
    expect(fixture.send).toHaveBeenCalledOnce();
  });
});
