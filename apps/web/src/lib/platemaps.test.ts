import { describe, expect, it } from 'vitest';
import {
  describeWell,
  plateGrid,
  pointsBySubject,
  roleClass,
  roleCounts,
  shade,
  subjectCount,
  subjectRoleOf,
  subjectsText,
  subjectWells,
  wellsText,
} from './platemaps.ts';

const plate = {
  plate: 1,
  wells: [
    {
      well: 'A1',
      role: 'standard',
      subject: 'standard',
      label: 'IL-6 standard',
      replicate: 1,
      point: 1,
      concentration: { value: '600', unit: 'pg/mL' },
    },
    {
      well: 'B1',
      role: 'standard',
      subject: 'standard',
      label: 'IL-6 standard',
      replicate: 1,
      point: 7,
    },
    { well: 'A3', role: 'sample', subject: 'ent_1', label: 'Donor 1', replicate: 1 },
    { well: 'A4', role: 'sample', subject: 'ent_1', label: 'Donor 1', replicate: 2 },
    { well: 'A5', role: 'sample', subject: 'ent_2', label: 'Donor 2', replicate: 1 },
    { well: 'H1', role: 'blank' },
    { well: 'H2', role: 'blank', override: true as const },
  ],
};

describe('plate map display', () => {
  it('draws roles in a few tones', () => {
    expect(roleClass('compound')).toBe('role-subject');
    expect(roleClass('positive_control')).toBe('role-positive');
    expect(roleClass('buffer')).toBe('role-blank');
    expect(roleClass('something')).toBe('role-other');
  });

  it('knows the grid of every standard format', () => {
    expect(plateGrid(96)).toMatchObject({ rows: 8, columns: 12 });
    expect(plateGrid(1536).rowLabels.at(-1)).toBe('AF');
  });

  it('shades a series from dark at the top to light at the bottom', () => {
    expect(shade({ point: 1 }, 7)).toBe(4);
    expect(shade({ point: 7 }, 7)).toBe(1);
    expect(shade({}, 7)).toBe(4);
    expect(pointsBySubject(plate).get('standard')).toBe(7);
  });

  it('describes wells in lab words', () => {
    expect(describeWell(plate.wells[0] as never, 7)).toBe(
      'A1: IL-6 standard, standard, point 1 of 7, 600 pg/mL',
    );
    expect(describeWell(plate.wells[3] as never)).toBe('A4: Donor 1, replicate 2');
    expect(describeWell(plate.wells[6] as never)).toBe('H2: Blank, changed by hand');
  });

  it('counts roles and subjects', () => {
    expect(roleCounts(plate)[0]).toEqual({ role: 'sample', count: 3 });
    expect(subjectCount(plate)).toBe(2);
  });

  it('says where each subject sits and counts in one word', () => {
    expect(subjectWells(plate as never)[0]).toEqual({
      subject: 'ent_1',
      label: 'Donor 1',
      wells: ['A3', 'A4'],
    });
    expect(subjectRoleOf([plate as never])).toBe('sample');
    expect(subjectsText(3)).toBe('3 samples');
    expect(subjectsText(1, 'compound')).toBe('1 compound');
    expect(wellsText(1)).toBe('1 well');
  });
});
