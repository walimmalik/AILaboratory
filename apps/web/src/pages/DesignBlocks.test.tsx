import type { RecordEnvelope } from '@ailab/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DesignBlock } from './DesignBlocks.tsx';

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: { queryKey: string[] }) => ({
    data: options.queryKey.includes('readiness') ? undefined : [],
  }),
  useMutation: () => ({ isPending: false }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

describe('DesignBlock', () => {
  it('offers saving a confirmed template-based experiment without plate maps or transfers', () => {
    const record = {
      id: 'exp_test',
      name: 'EXP-0001',
      label: 'Two-factor dose response',
      version: 1,
      status: 'active',
      attributes: { template: { id: 'asy_test', version: 1 } },
    } as unknown as RecordEnvelope;
    expect(renderToStaticMarkup(<DesignBlock record={record} />)).toContain('Save as a template');
    expect(renderToStaticMarkup(<DesignBlock record={{ ...record, status: 'draft' }} />)).toBe('');
    expect(renderToStaticMarkup(<DesignBlock record={{ ...record, attributes: {} }} />)).toBe('');
  });
});
