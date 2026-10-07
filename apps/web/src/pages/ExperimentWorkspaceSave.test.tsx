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
  fix: undefined as ((section: string) => void) | undefined,
  sections: [] as string[],
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey.includes('workspace') ? projection : queryKey[0] === 'kinds' ? [] : undefined,
    isFetching: false,
  }),
  useQueryClient: () => ({ setQueryData: mocks.cache }),
  useMutation: () => ({ isPending: false }),
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
  AllFields: ({
    onSaved,
    onlySection,
  }: {
    onSaved: (updated: RecordEnvelope) => void;
    onlySection: string;
  }) => {
    mocks.saved = onSaved;
    mocks.sections.push(onlySection);
    return null;
  },
}));
vi.mock('./RecordReview.tsx', async (original) => {
  const actual = await original<typeof import('./RecordReview.tsx')>();
  return {
    ...actual,
    ReadinessBlock: (props: React.ComponentProps<typeof actual.ReadinessBlock>) => {
      mocks.fix = props.onFix;
      return <actual.ReadinessBlock {...props} />;
    },
  };
});
it('keeps the question editor when the actual readiness protocol shortcut is used with unsaved edits', () => {
  mocks.navigate.mockClear();
  mocks.sections.length = 0;
  const onEdit = vi.fn();
  const onDetails = vi.fn();
  const readiness = {
    recordId: experiment,
    version: 3,
    status: 'draft',
    ready: false,
    sections: [
      { id: 'question', title: 'Question', state: 'needs_review', fields: [] },
      { id: 'protocol', title: 'Protocol', state: 'needs_review', fields: [] },
    ],
    assumed: [],
    unchecked: [],
    checks: [
      {
        id: 'protocol',
        label: 'Add an SOP to the protocol',
        source: 'An experiment needs a method',
        section: 'protocol',
        severity: 'blocker',
        passed: false,
      },
    ],
    notApplicable: [],
    missing: [],
  } as Readiness;
  const markup = renderToStaticMarkup(
    <ExperimentWorkspace
      record={{ ...record, status: 'draft' }}
      readiness={readiness}
      editing="question"
      onEdit={onEdit}
      onDetails={onDetails}
    />,
  );
  expect(markup).toContain('Fix in protocol');
  expect(markup).toContain(
    'Save or cancel your current edits before opening another design section.',
  );
  expect(mocks.sections).toEqual(['question']);
  mocks.fix?.('protocol');
  mocks.fix?.('subjects');
  expect(onEdit).not.toHaveBeenCalled();
  expect(onDetails).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
  mocks.fix?.('question');
  expect(onEdit).toHaveBeenCalledWith('question');
  expect(mocks.sections).toEqual(['question']);
});
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
