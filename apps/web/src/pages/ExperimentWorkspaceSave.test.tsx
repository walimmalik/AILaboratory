import {
  parseWorkspaceSelection,
  type Readiness,
  type RecordEnvelope,
  type WorkspaceProjection,
} from '@ailab/schema';
import { defaultStringifySearch } from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ExperimentWorkspace } from './ExperimentWorkspace.tsx';

const experiment = 'exp_00000000000000000000000000';
const record = {
  id: experiment,
  version: 3,
  kind: 'experiment',
  status: 'active',
  name: 'EXP-0001',
  label: 'Assay',
  attributes: { question: 'Before' },
  evidence: {},
} as unknown as RecordEnvelope;
const projection: Extract<WorkspaceProjection, { panel: 'design' }> = {
  panel: 'design',
  selection: {
    experiment,
    version: 3,
    view: { panel: 'design', detail: { id: 'lwt_00000000000000000000000000', version: 2 } },
  },
  experiment: {
    id: experiment,
    version: 3,
    kind: 'experiment',
    status: 'active',
    name: 'EXP-0001',
    label: 'Assay',
    question: 'Before',
    stage: 'designing',
    subjectCount: 1,
  },
  campaign: {
    id: 'cam_00000000000000000000000000',
    version: 1,
    kind: 'campaign',
    status: 'active',
    name: 'CAM-001',
    label: 'Campaign',
  },
  href: `/records/${experiment}`,
  related: { offset: 0, limit: 20, total: 0, hasMore: false, items: [] },
};
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  cache: vi.fn(),
  saved: undefined as ((updated: RecordEnvelope) => void) | undefined,
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: projection, isFetching: false }),
  useQueryClient: () => ({ setQueryData: mocks.cache }),
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mocks.navigate,
  useRouterState: () => ({
    search: {
      workspace: 'design',
      workspaceVersion: 3,
      workspaceDetail: 'lwt_00000000000000000000000000',
      workspaceDetailVersion: 2,
    },
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/test">{children}</a>,
}));
vi.mock('../assistant.tsx', () => ({ useAssistant: () => ({ setWorkspace: vi.fn() }) }));
vi.mock('./AllFields.tsx', () => ({
  AllFields: ({ onSaved }: { onSaved: (updated: RecordEnvelope) => void }) => {
    mocks.saved = onSaved;
    return null;
  },
}));
it('adopts only its own save receipt into a canonical reloadable view while retaining related selection', () => {
  const onEdit = vi.fn();
  const readiness = { ready: true, sections: [{ id: 'question', title: 'Question' }] } as Readiness;
  renderToStaticMarkup(
    <ExperimentWorkspace
      record={record}
      readiness={readiness}
      editing="question"
      onEdit={onEdit}
      onDetails={() => {}}
    />,
  );
  const updated = { ...record, version: 4, attributes: { question: 'Saved question' } };
  mocks.saved?.(updated);
  expect(onEdit).toHaveBeenCalledWith(undefined);
  expect(mocks.cache).toHaveBeenCalledWith(['record', experiment], updated);
  const navigation = mocks.navigate.mock.calls.at(-1)?.[0] as { search: Record<string, unknown> };
  const restored = parseWorkspaceSelection(
    experiment,
    new URLSearchParams(defaultStringifySearch(navigation.search)),
  );
  expect(restored).toEqual({ ...projection.selection, version: 4 });
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
});
