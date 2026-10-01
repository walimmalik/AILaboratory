import type { TransferGroup } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { rerunOf } from './reruns.ts';

const nL = (value: string) => ({ value, unit: 'nL' as const });
const t = {
  from: { plate: 'src', well: 'A1' },
  to: { plate: 'assay', well: 'A1' },
  volume: nL('25'),
};
const echo: TransferGroup = {
  id: 'compounds',
  label: 'Echo: compounds',
  method: 'direct_dispense',
  device: { label: 'Echo 1', min: nL('2.5'), max: nL('500'), step: nL('2.5') },
  reason: 'Nanolitre volumes',
  transfers: [t],
};

describe('what a rerun moves', () => {
  it('redoes a failed or missing transfer whole', () => {
    expect(rerunOf('failed', t, echo, nL('0'))).toEqual({ rerun: nL('25') });
    expect(rerunOf('not_run', t, echo)).toEqual({ rerun: nL('25') });
  });

  it('tops a short one up with the rest in whole steps of its device', () => {
    expect(rerunOf('short', t, echo, nL('10'))).toEqual({ rerun: nL('15') });
    // 25 - 11.2 = 13.8 nL is 5.52 droplets; the nearest whole number is 6 (15 nL).
    expect(rerunOf('short', t, echo, nL('11.2'))).toEqual({ rerun: nL('15') });
    // Less than half a droplet missing: nothing the Echo can move.
    expect(rerunOf('short', t, echo, nL('24'))).toMatchObject({
      note: expect.stringContaining('less than one step'),
    });
    expect(rerunOf('short', t, { ...echo, device: undefined }, nL('24'))).toEqual({
      rerun: { value: '1', unit: 'nL' },
    });
  });
});
