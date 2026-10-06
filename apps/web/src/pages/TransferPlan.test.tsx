import type { RecordEnvelope } from '@ailab/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TransferPlanBlocks } from './TransferPlan.tsx';

const labels = new Map([
  ['cnt_source', 'Compound stock plate'],
  ['pmp_assay', 'Assay layout'],
  ['ins_echo', 'Echo 650'],
]);
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQueries: ({ queries }: { queries: { queryKey: string[] }[] }) =>
    queries.map((query) => ({ data: { label: labels.get(query.queryKey[1] ?? '') } })),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: React.ReactNode; params: { id: string } }) => (
    <a href={`/records/${params.id}`}>{children}</a>
  ),
}));

const record = {
  id: 'tfp_test',
  kind: 'transfer_plan',
  label: 'Dose response transfers',
  attributes: {
    purpose: 'Place compounds in the assay plate.',
    notes: 'Check source concentration before use.',
    plates: [
      { id: 'src', label: 'Source plate', role: 'source', container: 'cnt_source' },
      {
        id: 'assay',
        label: 'Assay plate',
        role: 'destination',
        plateMap: { map: { id: 'pmp_assay', version: 2 }, plate: 1 },
      },
    ],
    groups: [
      {
        id: 'dose',
        label: 'Add compounds',
        instrument: { instrument: 'ins_echo' },
        device: { label: 'Echo 650' },
        reason: 'Small volumes with no tips.',
        transfers: [
          {
            from: { plate: 'src', well: 'A1' },
            to: { plate: 'assay', well: 'B2' },
            volume: { value: '0.025', unit: 'uL' },
          },
          {
            from: { plate: 'src', well: 'A2' },
            to: { plate: 'assay', well: 'B3' },
            volume: { value: '0.05', unit: 'uL' },
          },
        ],
      },
    ],
  },
} as unknown as RecordEnvelope;

describe('TransferPlanBlocks', () => {
  it('shows each saved movement, source, map, instrument, and notes for scientific review', () => {
    const html = renderToStaticMarkup(<TransferPlanBlocks record={record} />);
    expect(html).toContain('2 transfers in 1 group');
    expect(html).toContain('Source plate · A1');
    expect(html).toContain('Assay plate · B2');
    expect(html).toContain('Source plate · A2');
    expect(html).toContain('Assay plate · B3');
    expect(html).toContain('0.025');
    expect(html).toContain('0.05');
    expect(html).toContain('µL');
    expect(html).toContain('href="/records/cnt_source"');
    expect(html).toContain('Compound stock plate');
    expect(html).toContain('href="/records/pmp_assay"');
    expect(html).toContain('Assay layout');
    expect(html).toContain('href="/records/ins_echo"');
    expect(html).toContain('Small volumes with no tips.');
    expect(html).toContain('Check source concentration before use.');
    expect(html).not.toContain('tfp_test');
  });

  it('keeps an incomplete draft readable without claiming transfers', () => {
    const html = renderToStaticMarkup(
      <TransferPlanBlocks record={{ ...record, attributes: { plates: [], groups: [] } }} />,
    );
    expect(html).toContain('0 transfers in 0 groups');
    expect(html).toContain('No liquid transfers are in this plan yet.');
  });
});
