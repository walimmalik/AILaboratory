import type { RecordEnvelope, RunAttributes } from '@ailab/schema';
import { describe, expect, it, vi } from 'vitest';
import type { OverviewReader } from '../records/overview.ts';
import { campaignOverviews } from './overview.ts';

const at = '2026-10-05T12:00:00Z';
const user = { type: 'user' as const, userId: `usr_${'0'.repeat(26)}` };
function record(attributes: RunAttributes): RecordEnvelope {
  return {
    id: `run_${'0'.repeat(26)}`,
    name: 'RUN-0001',
    label: 'Plate assay',
    summary: 'The first plate',
    kind: 'run',
    status: 'active',
    version: 4,
    orgId: 'org_1',
    labId: 'lab_1',
    attributes,
    evidence: {},
    reviews: {},
    createdAt: at,
    updatedAt: at,
    createdBy: user,
    updatedBy: user,
  };
}
async function overview(attributes: RunAttributes) {
  const build = campaignOverviews.run;
  if (!build) throw new Error('Missing run overview builder');
  const read = { get: vi.fn() } as unknown as OverviewReader;
  const result = await build(record(attributes), read);
  expect(read.get).not.toHaveBeenCalled();
  return result;
}
const experiment = { id: `exp_${'0'.repeat(26)}`, version: 2 };

describe('run overview', () => {
  it('keeps the existing simple run facts and names execution status separately from confirmation', async () => {
    expect(
      await overview({
        experiment,
        status: 'done',
        date: '2026-10-05',
        operator: user.userId,
        startedAt: at,
        startedBy: user,
        finishedAt: '2026-10-05T14:30:00Z',
        steps: [],
        notes: 'A note kept in the run, not a key fact',
      }),
    ).toEqual({
      identity: [{ text: 'Run' }, { text: 'The first plate' }],
      facts: [
        { label: 'run status', value: 'done', field: 'status' },
        { label: 'date', value: '2026-10-05', field: 'date' },
        { label: 'started at', value: at, field: 'startedAt' },
        { label: 'finished at', value: '2026-10-05T14:30:00Z', field: 'finishedAt' },
      ],
    });
  });

  it.each(['scheduled', 'in_progress', 'failed', 'aborted'] as const)(
    'shows %s honestly without inventing missing dates',
    async (status) => {
      const result = await overview({ experiment, status });
      expect(result.facts).toEqual([
        { label: 'run status', value: status.replaceAll('_', ' '), field: 'status' },
      ]);
    },
  );
});
