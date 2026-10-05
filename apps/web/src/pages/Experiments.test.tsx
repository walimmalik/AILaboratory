import type { RecordEnvelope, RunStep } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunBlocks } from './Experiments.tsx';

const at = '2026-10-05T12:00:00Z';
const user = { type: 'user' as const, userId: 'usr_1' };
const step: RunStep = {
  part: 'assay',
  step: 'coat',
  title: 'Coat the plate',
  planned: [{ name: 'volume', value: { value: '100', unit: 'uL' } }],
  status: 'pending',
};
function html(checklist: RunStep[], status = 'in_progress') {
  const record: RecordEnvelope = {
    id: 'run_1',
    name: 'RUN-0001',
    label: 'Plate assay',
    kind: 'run',
    status: 'active',
    version: 3,
    orgId: 'org_1',
    labId: 'lab_1',
    evidence: {},
    reviews: {},
    attributes: { experiment: { id: 'exp_1', version: 2 }, status, steps: checklist },
    createdAt: at,
    updatedAt: at,
    createdBy: user,
    updatedBy: user,
  };
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RunBlocks record={record} />
    </QueryClientProvider>,
  );
}

describe('run checklist instructions', () => {
  it('shows captured paragraphs alongside the planned values and recorded deviation', () => {
    const text =
      'Add the coating solution. Cover the plate.\n\nIncubate overnight.\nKeep it level.';
    const markup = html([
      {
        ...step,
        text,
        status: 'done',
        deviation: { what: 'volume was 90 µL', why: 'Limited coating solution' },
      },
    ]);
    expect(markup).toContain('<b>Coat the plate.</b>');
    expect(markup).toContain(`<p class="sop-line run-instruction">${text}</p>`);
    expect(markup).toContain('Planned: volume 100 µL');
    expect(markup).toContain('volume was 90 µL. Why: Limited coating solution');
    expect(markup.indexOf(text)).toBeLessThan(markup.indexOf('Planned:'));
    expect(markup).not.toContain('Instruction text was not captured');
  });

  it('labels uncaptured history while keeping its title, planned values and recording controls', () => {
    const markup = html([step]);
    expect(markup).toContain('Instruction text was not captured for this run.');
    expect(markup).toContain('<b>Coat the plate.</b>');
    expect(markup).toContain('Planned: volume 100 µL');
    expect(markup).toContain('Done as planned');
    expect(markup).toContain('Something differed');
    expect(markup).toContain('Skipped');
    expect(markup).not.toContain('class="sop-line run-instruction"');
  });

  it('displays identical title and instruction once, retaining its line breaks on finished runs', () => {
    const text = 'Cover the plate.\n\nIncubate overnight.';
    const markup = html([{ ...step, title: text, text, status: 'done' }], 'done');
    expect(markup.split(text)).toHaveLength(2);
    expect(markup).toContain(`<b class="run-instruction">${text}</b>`);
    expect(markup).toContain('Planned: volume 100 µL');
    expect(markup).not.toContain('Instruction text was not captured');
    expect(markup).not.toContain('Done as planned');
  });
});
