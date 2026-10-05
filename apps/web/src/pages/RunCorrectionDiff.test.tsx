import type { RecordEnvelope, RecordVersion, RunStep } from '@ailab/schema';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { runCorrectionDiff } from '../lib/run-correction-diff.ts';
import { type DiffSide, ItemDiff, itemChanges } from './ItemDiff.tsx';
import { RecordHistory } from './RecordHistory.tsx';

vi.mock('../session.ts', () => ({ useMe: () => ({ user: { id: 'usr_scientist' } }) }));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({ data: [{ kind: 'run', items: {} }] }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="/test">{children}</a>,
}));
vi.mock('../assistant.tsx', () => ({ useAssistant: () => ({ show: vi.fn() }) }));
vi.mock('./RecordActions.tsx', () => ({ RestoreVersion: () => null }));

const at = '2026-10-05T09:00:00Z';
const by = { type: 'user' as const, userId: `usr_${'0'.repeat(26)}` };
const quantity = (value: string) => ({ value, unit: 'uL' });
const dispense: RunStep = {
  part: 'demo',
  step: 'dispense',
  title: 'Dispense demo buffer',
  text: 'Keep the virtual plate upright. Do not operate hardware.',
  planned: [{ name: 'volume', value: quantity('100') }],
  status: 'done',
  at,
  by,
};
const wash: RunStep = {
  ...dispense,
  step: 'wash',
  title: 'Wash the virtual plate',
  text: 'Record the virtual wash sequence.',
  planned: [{ name: 'times', value: '3' }],
};
function corrected(step: RunStep, value: string): RunStep {
  return {
    ...step,
    actuals: value === '100' ? undefined : [{ name: 'volume', value: quantity(value) }],
    deviation:
      value === '100'
        ? undefined
        : {
            what: `volume: ${value} µL (planned 100 µL)`,
            why: 'Rehearsal deviation',
            impact: 'Simulation only',
          },
    corrections: [
      ...(step.corrections ?? []),
      { at, by, why: 'Rehearsal deviation', source: 'Notebook entry' },
    ],
  };
}
const side = (step = dispense) => ({
  label: 'Simulated run',
  status: 'active',
  attributes: { status: 'done', steps: [step, wash], finishedAt: at },
});
function html(
  before: DiffSide = side(),
  after: DiffSide = side(corrected(dispense, '80')),
  adjacent = false,
) {
  return renderToStaticMarkup(
    <ItemDiff kind="run" before={before} after={after} adjacent={adjacent} />,
  );
}
const visible = (markup: string) => markup.split('<details class="tech">')[0] ?? '';

describe('run actual correction diff', () => {
  it('projects the actual whole-array diff used by Review while leaving snapshots untouched', () => {
    const before = side();
    const after = side(corrected(dispense, '80'));
    const changes = itemChanges(before, after, {});
    expect(changes).toEqual([
      {
        path: '/steps',
        change: 'changed',
        before: before.attributes.steps,
        after: after.attributes.steps,
      },
    ]);
    const projected = runCorrectionDiff(changes);
    expect(projected?.changes[0]).toMatchObject({
      before: '100 µL (recorded as planned)',
      after: '80 µL (actual)',
    });
    expect(projected?.unchanged).toBe(1);
    expect(before.attributes.steps[0]).toBe(dispense);
    expect(dispense.actuals).toBeUndefined();
  });
  it('leads with the title, actual, original plan and reason, folding unchanged steps and provenance', () => {
    const markup = html();
    const shown = visible(markup);
    for (const text of [
      'Dispense demo buffer · volume actual',
      '100 µL (recorded as planned)',
      '80 µL (actual)',
      'Original plan: 100 µL',
      'Rehearsal deviation',
      'Simulation only',
      'Notebook entry',
    ])
      expect(shown).toContain(text);
    for (const text of ['Wash the virtual plate', dispense.text ?? '', by.userId, at])
      expect(shown).not.toContain(text);
    expect(markup).toContain('Full checklist and correction details · 1 other step unchanged');
    expect(markup).toContain('Wash the virtual plate');
    expect(markup).toContain(dispense.text);
    expect(markup).not.toContain('<details class="tech" open');
  });
  it('identifies prior and corrected actuals without calling the prior actual a plan', () => {
    const prior = corrected(dispense, '90');
    for (const adjacent of [false, true]) {
      const shown = visible(html(side(prior), side(corrected(prior, '80')), adjacent));
      expect(shown).toContain('90 µL (actual)');
      expect(shown).toContain('80 µL (actual)');
      expect(shown).toContain('Original plan: 100 µL');
      expect(shown).not.toContain('90 µL (recorded as planned)');
    }
  });
  it('provides explicit before/after labels for the narrow correction layout only', () => {
    for (const adjacent of [false, true]) {
      const shown = visible(html(side(), side(corrected(dispense, '80')), adjacent));
      expect(shown).toContain('run-correction-diff');
      expect(shown).toContain('<span class="diff-side">Before: </span>');
      expect(shown).toContain('<span class="diff-side">After: </span>');
    }
    const generic = renderToStaticMarkup(
      <ItemDiff kind="run" before={{ label: 'Before' }} after={{ label: 'After' }} />,
    );
    expect(generic).not.toContain('run-correction-diff');
    expect(generic).not.toContain('diff-side');
  });
  it('shows a correction back to the original plan as recorded as planned', () => {
    const prior = corrected(dispense, '80');
    const shown = visible(html(side(prior), side(corrected(prior, '100'))));
    expect(shown).toContain('80 µL (actual)');
    expect(shown).toContain('100 µL (recorded as planned)');
    expect(shown).toContain('Rehearsal deviation');
  });
  it('keeps other changed record fields visible alongside the correction', () => {
    const before = { ...side(), label: 'Old run' };
    const after = { ...side(corrected(dispense, '80')), label: 'Corrected run' };
    const shown = visible(html(before, after));
    expect(shown).toContain('Old run');
    expect(shown).toContain('Corrected run');
    expect(shown).toContain('80 µL (actual)');
  });
  it('keeps unsupported changes in the generic diff instead of dropping them', () => {
    const changed = corrected(dispense, '80');
    for (const next of [
      { ...changed, text: 'A changed instruction' },
      { ...changed, planned: [{ name: 'volume', value: quantity('120') }] },
      { ...changed, status: 'skipped' },
      { ...changed, corrections: [] },
      { ...changed, unknown: 'Historical field' },
    ]) {
      const after = { ...side(), attributes: { ...side().attributes, steps: [next, wash] } };
      expect(runCorrectionDiff(itemChanges(side(), after))).toBeUndefined();
      const markup = html(side(), after);
      expect(markup).not.toContain('Full checklist and correction details');
      expect(markup).toContain('Wash the virtual plate');
    }
  });
  it('previews the actual correction in collapsed History and reuses the expanded comparison', () => {
    const record = (snapshot: ReturnType<typeof side>, version: number): RecordEnvelope => ({
      ...snapshot,
      id: `run_${'0'.repeat(26)}`,
      kind: 'run',
      name: 'RUN-0001',
      status: 'active',
      version,
      orgId: 'org_1',
      labId: 'lab_1',
      evidence: {},
      reviews: {},
      createdAt: at,
      updatedAt: at,
      createdBy: by,
      updatedBy: by,
    });
    const before = record(side(), 3);
    const after = record(side(corrected(dispense, '80')), 4);
    const versions: RecordVersion[] = [before, after].map((snapshot) => ({
      recordId: snapshot.id,
      version: snapshot.version,
      operation: 'update',
      actor: by,
      at,
      snapshot,
    }));
    const collapsed = renderToStaticMarkup(
      <RecordHistory record={after} versions={versions} ledger={[]} />,
    );
    expect(collapsed).toContain('100 µL (recorded as planned) → 80 µL (actual)');
    expect(collapsed.split('id="history-v4"')[1]).not.toContain(
      'Section confirmations and version details',
    );
    const expanded = renderToStaticMarkup(
      <RecordHistory record={after} versions={versions} ledger={[]} selected="v4" />,
    );
    expect(expanded).toContain('Original plan: 100 µL');
    expect(expanded).toContain('Full checklist and correction details');
  });
});
