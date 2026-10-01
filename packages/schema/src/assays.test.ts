import { describe, expect, it } from 'vitest';
import { AssayTemplateAttributes } from './assays.ts';

const sop = 'sop_01J9Z3K8Q4ABCDEFGHJKMNPQR1';
const elisa = {
  purpose: 'IL-6 in cell supernatants by sandwich ELISA',
  assays: ['ELISA'],
  parts: [{ id: 'assay', sop: { id: sop, version: 1 } }],
  roles: [{ part: 'assay', role: 'reader', capability: 'read_absorbance' }],
  essentials: [
    { input: 'subjects', id: 'samples', label: 'Which samples', kinds: ['sample'], max: 40 },
    {
      input: 'variable',
      id: 'dilution',
      label: 'Sample dilution',
      part: 'assay',
      variable: 'sample_dilution',
    },
  ],
  factors: [{ id: 'sample', label: 'Sample', from: 'samples' }],
  controls: [
    {
      id: 'std',
      label: 'IL-6 standard',
      role: 'standard',
      wells: 14,
      per: 'plate',
      reason: '7-point curve in duplicate',
    },
    { id: 'blank', label: 'Blank', role: 'blank', wells: 2, per: 'plate', reason: 'Background' },
  ],
  replicates: { technical: 2, reason: 'Duplicates are the kit convention' },
  readouts: [
    {
      id: 'od',
      label: 'Absorbance 450 nm, 570 nm reference',
      capability: 'read_absorbance',
      mode: 'endpoint',
      wavelengths: [
        { use: 'measure', wavelength: { value: '450', unit: 'nm' } },
        { use: 'reference', wavelength: { value: '570', unit: 'nm' } },
      ],
    },
  ],
  quality: [
    { measure: 'R² of the standard curve', comparison: '>=', threshold: '0.98', per: 'plate' },
  ],
  analysis: '4PL fit of the standards; interpolate samples',
};

describe('assay templates', () => {
  it('takes the ELISA template', () => {
    expect(AssayTemplateAttributes.safeParse(elisa).success).toBe(true);
  });

  it('refuses a factor with two sources of levels, a role with nothing to bind, and no readout', () => {
    const issues = (value: unknown) =>
      AssayTemplateAttributes.safeParse(value).error?.issues.map((i) => i.message) ?? [];
    expect(
      issues({
        ...elisa,
        factors: [{ id: 'sample', label: 'Sample', from: 'samples', levels: [{ id: 'a' }] }],
      }),
    ).toContain('give the levels, the essential input they come from, or a series: exactly one');
    expect(issues({ ...elisa, roles: [{ part: 'assay', role: 'reader' }] })).toContain(
      'give the capability the role needs, or a default record',
    );
    expect(issues({ ...elisa, readouts: [] })).not.toEqual([]);
  });
});
