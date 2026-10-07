import type { WorkspaceProjection } from '@ailab/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { WorkspaceDetail, WorkspacePager } from './ExperimentWorkspace.tsx';

const experiment = 'exp_00000000000000000000000000';
const summary = {
  id: experiment,
  version: 4,
  name: 'EXP-0001',
  kind: 'experiment',
  label: 'A saved experiment',
  status: 'draft' as const,
};
const projection: Extract<WorkspaceProjection, { panel: 'plates' }> = {
  panel: 'plates',
  experiment: { ...summary, question: 'What changes?', stage: 'designing', subjectCount: 5000 },
  campaign: {
    ...summary,
    id: 'cmp_00000000000000000000000000',
    name: 'CMP-0001',
    kind: 'campaign',
  },
  selection: { experiment, version: 4, view: { panel: 'plates' } },
  href: `/records/${experiment}`,
  maps: { items: [], offset: 50, limit: 20, total: 50, hasMore: false },
};

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/records/test">{children}</a>,
}));
it('renders bounded pagination with disabled next at an empty last page', () => {
  const html = renderToStaticMarkup(
    <WorkspacePager page={projection.maps} onPage={() => {}} label="Plate maps" />,
  );
  expect(html).toContain('0 shown');
  expect(html).toContain('of 50');
  expect(html).toMatch(/disabled="">Next/);
});
it('keeps related scientific facts, evidence uncertainty and deliberate full record navigation visible', () => {
  const html = renderToStaticMarkup(
    <WorkspaceDetail
      data={{
        ...projection,
        detail: {
          relation: 'labware',
          pinned: true,
          record: {
            id: 'lwt_00000000000000000000000000',
            version: 1,
            kind: 'labware_type',
            label: 'Assay plate',
            name: 'LWT-0001',
            status: 'active',
          },
          overview: {
            identity: [{ text: '96-well assay plate' }],
            facts: [{ label: 'Working volume', value: '100 µL' }],
            omittedFacts: 2,
            omittedIdentityParts: 0,
            relatedRecords: 'current',
          },
        },
      }}
      onClose={() => {}}
    />,
  );
  expect(html).toContain('Working volume');
  expect(html).toContain('100 µL');
  expect(html).toContain('Source unknown');
  expect(html).toContain('Close');
  expect(html).toContain('Open full record');
  expect(html).toContain('2 additional facts');
  expect(html).toContain('current lab records');
});
