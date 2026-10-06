import type { RecordEnvelope } from '@ailab/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperimentTransfers, startTransferPlanning } from './DesignBlocks.tsx';

const state = vi.hoisted(() => ({
  maps: [] as RecordEnvelope[],
  plans: [] as RecordEnvelope[],
  configured: true,
  sending: false,
  running: false,
}));
vi.mock('../assistant.tsx', () => ({
  useAssistant: () => ({ send: vi.fn(), sending: state.sending, running: state.running }),
}));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: { queryKey: [string, ({ kind?: string } | string)?] }) => {
    const [key, filter] = options.queryKey;
    if (key === 'records')
      return {
        data: typeof filter === 'object' && filter?.kind === 'plate_map' ? state.maps : state.plans,
        isPending: false,
        error: null,
      };
    if (key === 'assistant' && filter === 'setup')
      return { data: { configured: state.configured }, isPending: false, isError: false };
    return { data: undefined, isPending: false, isError: false };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => (
    <a href="/records/example">{children as React.ReactNode}</a>
  ),
  useNavigate: () => vi.fn(),
}));

const experiment = {
  id: 'exp_test',
  name: 'EXP-0001',
  label: 'Dose response',
  version: 4,
  status: 'active',
  readiness: { blockers: 0, warnings: 0, assumed: 0, sectionsLeft: [], changed: [], ready: true },
  attributes: {},
} as unknown as RecordEnvelope;
const confirmedMap = {
  id: 'pmp_test',
  name: 'PMP-0001',
  label: 'Assay plate',
  version: 3,
  status: 'active',
  readiness: { blockers: 0, warnings: 0, assumed: 0, sectionsLeft: [], changed: [], ready: true },
  attributes: { experiment: experiment.id },
} as unknown as RecordEnvelope;
const markup = (record = experiment) =>
  renderToStaticMarkup(<ExperimentTransfers record={record} />);

beforeEach(() => {
  state.maps = [];
  state.plans = [];
  state.configured = true;
  state.sending = false;
  state.running = false;
});

describe('experiment transfer handoff', () => {
  it('requires a confirmed experiment and current confirmed map', () => {
    expect(markup()).toContain('Confirm a plate map on the Plates tab');
    expect(markup()).toContain('disabled="">Plan transfers</button>');
    state.maps = [{ ...confirmedMap, status: 'draft' }];
    expect(markup()).toContain('disabled="">Plan transfers</button>');
    state.maps = [
      {
        ...confirmedMap,
        readiness: {
          ready: true,
          blockers: 0,
          warnings: 0,
          assumed: 0,
          sectionsLeft: [],
          changed: ['Wells'],
        },
      },
    ];
    expect(markup()).toContain('disabled="">Plan transfers</button>');
    state.maps = [confirmedMap];
    expect(markup()).toContain('>Plan transfers</button>');
    expect(markup({ ...experiment, status: 'draft' })).toContain('Finish reviewing the experiment');
  });

  it('requires an explicit choice when several maps are confirmed and keeps existing plans visible', () => {
    state.maps = [confirmedMap, { ...confirmedMap, id: 'pmp_second', label: 'Follow-up plate' }];
    state.plans = [
      {
        ...confirmedMap,
        id: 'tfp_existing',
        label: 'First transfer plan',
        attributes: { experiment: experiment.id, groups: [], plates: [] },
      },
    ];
    const html = markup();
    expect(html).toContain('Choose a plate map');
    expect(html).toContain('disabled="">Plan transfers</button>');
    expect(html).toContain('Follow-up plate');
    expect(html).toContain('First transfer plan');
  });

  it('sends the selected map version and asks for supported, calculated work without duplicate drafts', async () => {
    const send = vi.fn().mockResolvedValue(true);
    await startTransferPlanning(send, experiment, confirmedMap);
    const [message, options] = send.mock.calls[0] ?? [];
    expect(options).toEqual({
      fresh: true,
      context: { record: { id: confirmedMap.id, name: confirmedMap.name, version: 3 } },
    });
    expect(message).toContain('[Assay plate](/records/pmp_test)');
    expect(message).toContain('[Dose response](/records/exp_test)');
    expect(message).toContain('check any existing transfer plans before drafting');
    expect(message).toContain(
      'source containers and wells, stock concentrations, final well volume',
    );
    expect(message).toContain('Ask me about missing facts instead of guessing');
    expect(message).toContain('Draft only the liquid transfers supported by this plate map');
    expect(message).not.toContain('transfers.');
  });
});
