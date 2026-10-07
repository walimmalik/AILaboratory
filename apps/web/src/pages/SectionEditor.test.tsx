import type { RecordEnvelope } from '@ailab/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { useFieldEdits } from './SectionEditor.tsx';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(async () => {}),
  success: undefined as ((updated: RecordEnvelope) => Promise<void>) | undefined,
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: (options: { onSuccess: (updated: RecordEnvelope) => Promise<void> }) => {
    mocks.success = options.onSuccess;
    return {};
  },
}));

it('closes an acknowledged saved editor and hands its exact receipt to the host before refreshes', async () => {
  const record = {
    id: 'exp_fixture',
    version: 3,
    attributes: { question: 'Before' },
  } as unknown as RecordEnvelope;
  const updated = { ...record, version: 4, attributes: { question: 'Saved question' } };
  const events: string[] = [];
  const onSaved = vi.fn((receipt: RecordEnvelope) => {
    events.push(`saved ${receipt.version}`);
  });
  mocks.invalidate.mockImplementation(async () => {
    events.push('refresh');
  });
  function Host() {
    useFieldEdits(record, ['question'], () => events.push('closed'), onSaved);
    return null;
  }
  renderToStaticMarkup(<Host />);
  await mocks.success?.(updated);
  expect(onSaved).toHaveBeenCalledWith(updated);
  expect(events.slice(0, 2)).toEqual(['closed', 'saved 4']);
  expect(events.filter((event) => event === 'closed')).toHaveLength(1);
  expect(events.filter((event) => event === 'refresh')).toHaveLength(3);
});
