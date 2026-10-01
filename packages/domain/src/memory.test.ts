import type { MemoryAttributes } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import {
  type ActiveMemory,
  addMonths,
  appliedEffects,
  checkAgainFor,
  conditionsOverlap,
  DEFAULT_BAR,
  evidenceLine,
  isDue,
  matchConflicts,
  memoriesFor,
  memoryConflicts,
  memoryEvidence,
  passesBar,
  showsPattern,
} from './memory.ts';

describe('lab memory dates', () => {
  it('adds months, keeping to the end of shorter months', () => {
    expect(addMonths('2026-09-30', 6)).toBe('2027-03-30');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 12)).toBe('2027-12-15');
  });

  it('sets the check-again date by kind, never for preferences', () => {
    expect(checkAgainFor('quirk', '2026-10-01')).toBe('2027-04-01');
    expect(checkAgainFor('lesson', '2026-10-01')).toBe('2027-04-01');
    expect(checkAgainFor('convention', '2026-10-01')).toBe('2027-10-01');
    expect(checkAgainFor('fact', '2026-10-01')).toBe('2027-10-01');
    expect(checkAgainFor('preference', '2026-10-01')).toBeUndefined();
  });

  it('is due on and after its date', () => {
    expect(isDue('2026-10-01', '2026-09-30')).toBe(false);
    expect(isDue('2026-10-01', '2026-10-01')).toBe(true);
    expect(isDue(undefined, '2030-01-01')).toBe(false);
  });
});

const id = (prefix: string, n: number) => `${prefix}_01J9Z3K8Q4ABCDEFGHJKMNPQR${n}`;
const uL = (value: string) => ({ value, unit: 'uL' as const });
const star = id('ink', 1);
const flex = id('ink', 2);
const water = id('lqt', 1);
const priya = 'usr_01J9Z3K8Q4ABCDEFGHJKMNPQR1';
let n = 0;
const mem = (a: Partial<MemoryAttributes>, updatedAt = '2026-10-01T00:00:00Z'): ActiveMemory => {
  n++;
  return {
    id: id('mem', n % 10),
    name: `MEM-000${n}`,
    updatedAt,
    attributes: {
      statement: `Memory ${n}`,
      kind: 'quirk',
      strength: 'default',
      appliesTo: { to: 'lab' },
      source: { from: 'stated' },
      ...a,
    },
  };
};

describe('which memories apply', () => {
  const drip = mem({
    about: [star],
    conditions: { instrumentKind: star, volume: { max: uL('5') }, liquidType: water },
    effect: { effect: 'avoid', record: star },
  });
  const work = (volume: string) => ({
    records: [star, flex, water],
    facts: { instrumentKind: star, volume: uL(volume), liquidType: water },
  });

  it('applies a memory whose conditions all hold, and drops it when one does not', () => {
    expect(memoriesFor([drip], work('3'))).toMatchObject([
      { applies: true, conditions: 3, links: 1 },
    ]);
    expect(
      memoriesFor([drip], {
        ...work('3'),
        facts: { ...work('3').facts, volume: { value: '3000', unit: 'nL' } },
      }),
    ).toHaveLength(1);
    expect(memoriesFor([drip], work('20'))).toEqual([]);
  });

  it('shows a memory it cannot evaluate without applying it', () => {
    const [m] = memoriesFor([drip], { records: [star], facts: { instrumentKind: star } });
    expect(m).toMatchObject({ applies: false, unknown: ['volume', 'liquidType'] });
  });

  it('leaves out memories about other records, lab-wide notes without a matching condition, and other people', () => {
    const other = mem({ about: [flex] });
    const labNote = mem({ strength: 'note' });
    const labRule = mem({ strength: 'rule' });
    const hers = mem({ about: [star], appliesTo: { to: 'person', user: priya } });
    const got = memoriesFor([other, labNote, labRule, hers], { records: [star], facts: {} });
    expect(got.map((m) => m.memory)).toEqual([labRule]);
    expect(
      memoriesFor([hers], { records: [star], facts: {}, person: priya }).map((m) => m.memory),
    ).toEqual([hers]);
  });

  it('orders by strength, then personal, conditions, links and newest', () => {
    const note = mem({ about: [star], strength: 'note' });
    const rule = mem({ about: [star], strength: 'rule' });
    const mine = mem({ about: [star], appliesTo: { to: 'person', user: priya } });
    const narrow = mem({ about: [star], conditions: { instrumentKind: star } });
    const old = mem({ about: [star] }, '2026-01-01T00:00:00Z');
    const fresh = mem({ about: [star] }, '2026-09-01T00:00:00Z');
    const got = memoriesFor([note, old, fresh, narrow, mine, rule], {
      records: [star],
      facts: { instrumentKind: star },
      person: priya,
    });
    expect(got.map((m) => m.memory)).toEqual([rule, mine, narrow, fresh, old, note]);
  });

  it('applies the most specific effect per record and neither of two that clash', () => {
    const prefer = mem({ about: [star], effect: { effect: 'prefer', record: flex } });
    const wider = mem({
      about: [star],
      conditions: { instrumentKind: star },
      effect: { effect: 'avoid', record: flex },
    });
    const request = { records: [star], facts: { instrumentKind: star } };
    const effects = appliedEffects(memoriesFor([prefer, wider], request));
    expect([...effects.avoid.keys()]).toEqual([flex]);
    expect(effects.prefer.size).toBe(0);

    const two = mem({ about: [star], effect: { effect: 'set', slot: 'replicates', value: 2 } });
    const three = mem({ about: [star], effect: { effect: 'set', slot: 'replicates', value: 3 } });
    const matches = memoriesFor([two, three], request);
    expect(matchConflicts(matches)).toMatchObject([
      { why: 'they set replicates to different values' },
    ]);
    expect(appliedEffects(matches).set.size).toBe(0);
  });
});

describe('memories that cannot be confirmed together', () => {
  it('overlaps conditions key by key', () => {
    expect(conditionsOverlap({ volume: { max: uL('5') } }, { volume: { min: uL('2') } })).toBe(
      true,
    );
    expect(conditionsOverlap({ volume: { max: uL('5') } }, { volume: { min: uL('10') } })).toBe(
      false,
    );
    expect(conditionsOverlap({ instrumentKind: star }, { liquidType: water })).toBe(true);
    expect(conditionsOverlap({ samples: { max: 95 } }, { samples: { min: 96 } })).toBe(false);
    expect(conditionsOverlap({ roles: ['standard'] }, { roles: ['blank'] })).toBe(false);
  });

  it('blocks clashing effects at equal specificity, not a more specific one', () => {
    const active = mem({ about: [star], effect: { effect: 'prefer', record: flex } });
    const draft = {
      ...mem({ about: [star], effect: { effect: 'avoid', record: flex } }).attributes,
    };
    expect(memoryConflicts(draft, [active])).toMatchObject([
      { memory: active, why: 'one prefers and the other avoids the same record' },
    ]);
    expect(memoryConflicts({ ...draft, conditions: { instrumentKind: star } }, [active])).toEqual(
      [],
    );
    expect(memoryConflicts({ ...draft, strength: 'rule' }, [active])).toEqual([]);
    expect(
      memoryConflicts({ ...draft, effect: { effect: 'prefer', record: id('ink', 3) } }, [active]),
    ).toMatchObject([{ why: 'they prefer different records for the same choice' }]);
  });
});

describe('memory candidates', () => {
  const runs = (from: number, to: number, day: (i: number) => string) =>
    Array.from({ length: to - from }, (_, i) => ({
      evidence: `run_${from + i}`,
      day: day(from + i),
    }));
  const twoDays = (i: number) => (i < 2 ? '2026-10-01' : '2026-10-02');

  it('proposes after 3 runs on 2 days, and not before', () => {
    expect(passesBar(runs(0, 2, twoDays), DEFAULT_BAR)).toBe(false);
    expect(
      passesBar(
        runs(0, 3, () => '2026-10-01'),
        DEFAULT_BAR,
      ),
    ).toBe(false);
    expect(passesBar(runs(0, 3, twoDays), DEFAULT_BAR)).toBe(true);
    expect(passesBar([...runs(0, 2, twoDays), ...runs(0, 2, twoDays)], DEFAULT_BAR)).toBe(false);
  });

  it('proposes a rejected candidate again only once the evidence since doubles', () => {
    expect(passesBar(runs(0, 6, twoDays), DEFAULT_BAR, 3)).toBe(false);
    expect(passesBar(runs(0, 9, twoDays), DEFAULT_BAR, 3)).toBe(true);
  });

  it('says what it was seen in', () => {
    expect(evidenceLine(runs(0, 4, twoDays), { one: 'run', many: 'runs' })).toBe(
      'seen in 4 runs on 2 days since 2026-10-01',
    );
  });

  it('counts evidence for and against, quiet opportunities since last seen, and when it is due', () => {
    const noun = { one: 'run', many: 'runs' };
    const seen = runs(0, 3, twoDays);
    const quiet = (from: number, to: number, day: string) =>
      runs(from, to, () => day).map((o) => ({ ...o, finding: 'quiet' as const }));
    // A quiet run before the last sighting doesn't count.
    const early = { evidence: 'run_x', day: '2026-10-01', finding: 'quiet' as const };
    expect(memoryEvidence([...seen, early, ...quiet(10, 19, '2026-10-05')], noun)).toEqual({
      for: 3,
      against: 0,
      quiet: 9,
      lastSeen: '2026-10-02',
      weight: 3,
      line: 'seen in 3 runs, last 2026-10-02; not seen in the last 9 matching runs since 2026-10-02',
    });
    expect(memoryEvidence([...seen, ...quiet(10, 20, '2026-10-05')], noun).due).toBe('quiet');
    expect(memoryEvidence([...seen, ...quiet(10, 13, '2026-10-05')], noun, 3).due).toBe('quiet');
    const against = runs(20, 24, twoDays).map((o) => ({ ...o, finding: 'against' as const }));
    expect(memoryEvidence([...seen, ...against], noun)).toMatchObject({
      against: 4,
      weight: -1,
      due: 'against',
      line: 'seen in 3 runs, last 2026-10-02, 4 against',
    });
  });

  it('orders memories of equal specificity by weight, without making them clash', () => {
    const weak = mem({ about: [star], strength: 'note' }, '2026-10-05T00:00:00Z');
    const strong = {
      ...mem({ about: [star], strength: 'note' }),
      evidence: memoryEvidence(runs(0, 5, twoDays), { one: 'run', many: 'runs' }),
    };
    const got = memoriesFor([weak, strong], { records: [star], facts: {} });
    expect(got.map((m) => m.memory.id)).toEqual([strong.id, weak.id]);
  });

  it('counts a report as showing a pattern from 2 items and 5% of them', () => {
    expect(showsPattern(1, 10)).toBe(false);
    expect(showsPattern(2, 20)).toBe(true);
    expect(showsPattern(2, 41)).toBe(false);
    expect(showsPattern(0, 0)).toBe(false);
  });
});
