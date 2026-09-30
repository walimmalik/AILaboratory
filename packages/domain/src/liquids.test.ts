import type { LiquidClassAttributes } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { type ClassInfo, mixtureLiquidType, resolveClass, verificationResult } from './liquids.ts';

const id = (prefix: string, n: number) => `${prefix}_01J9Z3K8Q4ABCDEFGHJKMNPQR${n}`;
const water = id('lqt', 1);
const dmso = id('lqt', 2);
const glycerol = id('lqt', 3);
const uL = (value: string) => ({ value, unit: 'uL' as const });

describe('mixtureLiquidType', () => {
  it('lets the largest part decide', () => {
    const m = mixtureLiquidType([
      { liquidType: water, base: 'aqueous', volume: uL('99.5') },
      { liquidType: dmso, base: 'dmso', volume: { value: '0.5', unit: 'uL' } },
    ]);
    expect(m).toMatchObject({ liquidType: water, base: 'aqueous' });
    expect(m.shares).toEqual([
      { base: 'aqueous', percent: '99.5' },
      { base: 'dmso', percent: '0.5' },
    ]);
  });

  it('lets a solvent past its threshold decide', () => {
    expect(
      mixtureLiquidType([
        { liquidType: water, base: 'aqueous', volume: uL('50') },
        { liquidType: glycerol, base: 'glycerol', volume: { value: '0.05', unit: 'mL' } },
      ]),
    ).toMatchObject({ liquidType: glycerol, base: 'glycerol' });
    // Exactly 20% glycerol is not over 20%.
    expect(
      mixtureLiquidType([
        { liquidType: water, base: 'aqueous', volume: uL('80') },
        { liquidType: glycerol, base: 'glycerol', volume: uL('20') },
      ]).base,
    ).toBe('aqueous');
    expect(
      mixtureLiquidType([
        { liquidType: water, base: 'aqueous', volume: uL('30') },
        { liquidType: dmso, base: 'dmso', volume: uL('70') },
      ]).why,
    ).toContain('at least 70% DMSO');
  });
});

describe('verificationResult', () => {
  const run = {
    liquidClass: id('lqc', 1),
    method: 'gravimetric' as const,
    date: '2026-09-30',
    target: uL('10'),
    replicates: 10,
    mean: uL('10.3'),
    cv: '1.2',
    limits: { accuracy: '5', cv: '3' },
    demo: false,
  };
  it('passes within both limits and fails outside either', () => {
    expect(verificationResult(run)).toMatchObject({ accuracy: '3', passed: true });
    expect(verificationResult({ ...run, mean: { value: '0.0094', unit: 'mL' } })).toMatchObject({
      accuracy: '-6',
      passed: false,
    });
    expect(verificationResult({ ...run, cv: '4' }).why).toBe(
      'Failed: accuracy 3% (limit ±5%), CV 4% (limit 3%)',
    );
  });
});

describe('resolveClass', () => {
  const flex = id('ink', 1);
  const p1000 = id('eqk', 1);
  const tips200 = id('lwt', 1);
  const cls = (
    n: number,
    extra: Partial<LiquidClassAttributes> = {},
    info: Partial<ClassInfo> = {},
  ): ClassInfo => ({
    id: id('lqc', n),
    label: `Class ${n}`,
    active: true,
    verified: false,
    attributes: {
      instrumentKind: flex,
      device: p1000,
      tips: [tips200],
      volume: { min: uL('5'), max: uL('200') },
      liquidTypes: [water],
      labDefault: false,
      origin: 'vendor_default',
      settings: { platform: 'manual', technique: 'forward', preWet: false, speed: 'normal' },
      ...extra,
    },
    ...info,
  });
  const request = {
    instrumentKind: flex,
    device: p1000,
    tip: tips200,
    volume: uL('50'),
    liquidType: water,
    liquidTypeLabel: 'Aqueous',
  };

  it('picks the lab default for the liquid type, preferring a verified one', () => {
    const classes = [
      cls(1, { labDefault: true }),
      cls(2, { labDefault: true }, { verified: true }),
      cls(3),
    ];
    const choice = resolveClass(request, classes);
    expect(choice).toMatchObject({ liquidClass: id('lqc', 2), how: 'lab_default', verified: true });
    expect(choice.alternatives.map((a) => a.liquidClass)).toEqual([id('lqc', 1), id('lqc', 3)]);
  });

  it('puts an explicit choice first, then a product override', () => {
    const classes = [cls(1, { labDefault: true }), cls(2, { liquidTypes: [glycerol] })];
    expect(resolveClass({ ...request, productOverrides: [id('lqc', 2)] }, classes)).toMatchObject({
      liquidClass: id('lqc', 2),
      how: 'product_override',
    });
    expect(
      resolveClass(
        { ...request, explicit: id('lqc', 1), productOverrides: [id('lqc', 2)] },
        classes,
      ),
    ).toMatchObject({
      liquidClass: id('lqc', 1),
      how: 'explicit',
    });
  });

  it('says why nothing fits', () => {
    const classes = [cls(1, { labDefault: true }), cls(2, { labDefault: true }, { active: false })];
    expect(resolveClass({ ...request, volume: uL('500') }, classes)).toMatchObject({
      how: 'none',
      issue: 'No validated class for Aqueous on this device and tip at 500 µL',
    });
    expect(
      resolveClass({ ...request, explicit: id('lqc', 1), volume: uL('2') }, classes).issue,
    ).toBe("Class 1 doesn't fit: it starts at 5 µL");
    expect(
      resolveClass({ ...request, tip: id('lwt', 2) }, [
        cls(2, { labDefault: true }, { active: false }),
      ]).issue,
    ).toBe('No validated class for Aqueous on this device and tip at 50 µL');
    expect(
      resolveClass(request, [cls(2, { labDefault: true }, { active: false })]).issue,
    ).toContain('draft Class 2 would fit once confirmed');
  });
});
