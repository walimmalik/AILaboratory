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
  it('shows one Planned/Recorded comparison for a corrected step without duplicating generated quantities or punctuation', () => {
    const text = 'Add the buffer.\nKeep the plate level.';
    const markup = html(
      [
        {
          ...step,
          text,
          status: 'done',
          actuals: [{ name: 'volume', value: { value: '80', unit: 'uL' } }],
          deviation: {
            what: 'volume 80 µL (planned 100 µL)',
            why: 'Notebook correction.',
            impact: 'Lower signal.',
          },
        },
      ],
      'done',
    );
    expect(markup).toContain(`class="sop-line run-instruction">${text}</p>`);
    expect(markup).toContain('Planned: volume 100 µL</p>');
    expect(markup).toContain('Recorded: volume 80 µL</p>');
    expect(markup.match(/100 µL/g)).toHaveLength(1);
    expect(markup.match(/80 µL/g)).toHaveLength(1);
    expect(markup).toContain('Why: Notebook correction.</p>');
    expect(markup).toContain('Impact: Lower signal.</p>');
    expect(markup).not.toContain('. .');
    expect(markup).not.toContain('Done as planned');
  });

  it('preserves additional recorded meaning with multiple actuals and an unplanned parameter', () => {
    const actuals = [
      { name: 'volume', value: { value: '80', unit: 'uL' } },
      { name: 'duration', value: { value: '20', unit: 'min' } },
    ];
    const generated = 'volume 80 µL (planned 100 µL); duration 20 min (planned nothing)';
    const done = {
      ...step,
      status: 'done' as const,
      actuals,
      deviation: { what: generated, why: 'From the notebook' },
    };
    const markup = html([done], 'done');
    expect(markup).toContain('Recorded: volume 80 µL · duration 20 min');
    expect(markup).not.toContain('(planned');
    const explanation = `${generated}; the plate was moved to shade.`;
    expect(
      html([{ ...done, deviation: { ...done.deviation, what: explanation } }], 'done'),
    ).toContain(explanation);
  });

  it('keeps skipped explanations without inventing recorded quantities', () => {
    const markup = html([
      {
        ...step,
        status: 'skipped',
        deviation: {
          what: 'Wash was omitted.',
          why: 'Plate unavailable.',
          impact: 'Result cannot be compared.',
        },
      },
    ]);
    expect(markup).toContain('skipped');
    expect(markup).toContain('Planned: volume 100 µL');
    expect(markup).toContain('Wash was omitted.</p>');
    expect(markup).toContain('Why: Plate unavailable.</p>');
    expect(markup).not.toContain('Recorded:');
  });
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
    expect(markup).toContain('volume was 90 µL</p>');
    expect(markup).toContain('Why: Limited coating solution</p>');
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
