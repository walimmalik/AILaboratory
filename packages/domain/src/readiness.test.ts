import type { Actor, KindCheck, KindSection, RecordEnvelope } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { readiness, sameValue, sectionValues } from './readiness.ts';

const person: Actor = { type: 'user', userId: 'usr_01J9ZS4K8D6W3M5T7V9X1Y2Z3A' } as Actor;
const agent: Actor = {
  type: 'agent',
  agentName: 'Lab assistant',
  onBehalfOf: 'usr_01J9ZS4K8D6W3M5T7V9X1Y2Z3A',
} as Actor;
const at = '2026-09-29T12:00:00.000Z';

const sections: KindSection[] = [
  { id: 'appearance', title: 'Appearance', fields: ['color'] },
  { id: 'volume', title: 'Volume', fields: ['volume'] },
];
const checks: KindCheck<never>[] = [
  {
    id: 'volume_positive',
    label: 'Volume is more than zero',
    severity: 'blocker',
    source: 'Widget spec',
    test: (a: { volume: { value: string } }) =>
      Number(a.volume.value) > 0 || 'Volume must be more than zero',
  } as unknown as KindCheck<never>,
  {
    id: 'color_known',
    label: 'Color is known',
    severity: 'warning',
    source: 'Widget spec',
    test: (a: { color: string }) => a.color !== 'unknown' || 'Color is unknown',
  } as unknown as KindCheck<never>,
];

function widget(overrides: Partial<RecordEnvelope> = {}): RecordEnvelope {
  return {
    id: 'rec_01J9ZS4K8D6W3M5T7V9X1Y2Z3A',
    kind: 'widget',
    name: 'WID-0001',
    label: 'Blue widget',
    orgId: 'org_01J9ZS4K8D6W3M5T7V9X1Y2Z3A',
    labId: 'lab_01J9ZS4K8D6W3M5T7V9X1Y2Z3A',
    status: 'draft',
    version: 1,
    attributes: { color: 'blue', volume: { value: '5', unit: 'mL' } },
    evidence: {
      color: { source: 'assumed', by: agent, at },
      volume: { source: 'datasheet', by: agent, at, reference: 'https://example.org/spec' },
    },
    reviews: {},
    createdAt: at,
    createdBy: agent,
    updatedAt: at,
    updatedBy: agent,
    ...overrides,
  } as RecordEnvelope;
}

function confirmed(record: RecordEnvelope, section: KindSection) {
  return {
    confirmedBy: person,
    confirmedAt: at,
    version: record.version,
    values: sectionValues(section, record.attributes),
  };
}

describe('sameValue', () => {
  it('ignores key order and compares nested values', () => {
    expect(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameValue({ value: '5', unit: 'mL' }, { value: '5', unit: 'uL' })).toBe(false);
    expect(sameValue(undefined, undefined)).toBe(true);
  });
});

describe('readiness', () => {
  it('lists every unconfirmed section and marks agent estimates as assumed', () => {
    const result = readiness(widget(), { sections, checks });
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(['Appearance is not confirmed', 'Volume is not confirmed']);
    expect(result.assumed).toEqual(['color']);
    expect(result.sections[1]?.fields[0]).toMatchObject({ state: 'unconfirmed', assumed: false });
  });

  it('is ready once every section is confirmed and no blocker fails', () => {
    const record = widget();
    record.reviews = {
      appearance: confirmed(record, sections[0] as KindSection),
      volume: confirmed(record, sections[1] as KindSection),
    };
    const result = readiness(record, { sections, checks });
    expect(result).toMatchObject({ ready: true, missing: [], assumed: [] });
    expect(result.sections.map((s) => s.state)).toEqual(['confirmed', 'confirmed']);
  });

  it('sends a section back to review when a value changes, keeping the confirmed value', () => {
    const record = widget();
    record.reviews = { volume: confirmed(record, sections[1] as KindSection) };
    record.attributes = { ...record.attributes, volume: { value: '8', unit: 'mL' } };
    const volume = readiness(record, { sections, checks }).sections[1];
    expect(volume?.state).toBe('needs_review');
    expect(volume?.fields[0]).toMatchObject({
      state: 'changed',
      confirmedValue: { value: '5', unit: 'mL' },
    });
    expect(readiness(record, { sections, checks }).missing).toContain(
      'Volume changed since it was confirmed',
    );
  });

  it('a failing blocker stops readiness; a failing warning does not', () => {
    const record = widget({
      attributes: { color: 'unknown', volume: { value: '0', unit: 'mL' } },
    });
    record.reviews = {
      appearance: confirmed(record, sections[0] as KindSection),
      volume: confirmed(record, sections[1] as KindSection),
    };
    const result = readiness(record, { sections, checks });
    expect(result.missing).toEqual(['Volume must be more than zero']);
    expect(result.checks.map((c) => c.passed)).toEqual([false, false]);

    record.attributes = { color: 'unknown', volume: { value: '1', unit: 'mL' } };
    record.reviews.volume = confirmed(record, sections[1] as KindSection);
    expect(readiness(record, { sections, checks }).ready).toBe(true);
  });

  it('a check that throws fails with its error', () => {
    const broken = [
      {
        ...checks[0],
        test: () => {
          throw new Error('no volume');
        },
      },
    ] as unknown as KindCheck<never>[];
    expect(readiness(widget(), { sections, checks: broken }).checks[0]).toMatchObject({
      passed: false,
      message: 'no volume',
    });
  });

  it('leaves out checks and attributes that do not apply to these values', () => {
    const colorOnlyForBlue = [
      checks[0],
      { ...checks[1], applies: (a: { color: string }) => a.color === 'red' },
    ] as unknown as KindCheck<never>[];
    const result = readiness(widget(), {
      sections,
      checks: colorOnlyForBlue,
      notApplicable: (a: { color: string }) => (a.color === 'blue' ? ['volume.unit'] : []),
    } as never);
    expect(result.checks.map((c) => c.id)).toEqual(['volume_positive']);
    expect(result.notApplicable).toEqual(['volume.unit']);
  });
});
