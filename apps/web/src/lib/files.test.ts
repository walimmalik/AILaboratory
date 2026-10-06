import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileOf, fileSize, filesOf } from './files.ts';

const definition = JSON.parse(
  readFileSync(
    new URL('../../../../seed/opentrons/nest_12_reservoir_15ml.json', import.meta.url),
    'utf8',
  ),
);

describe('fileOf', () => {
  it('turns an Opentrons export into a file named by its load name', () => {
    const file = fileOf('labware.export_opentrons', { definition });
    expect(file).toMatchObject({
      name: 'nest_12_reservoir_15ml.json',
      mediaType: 'application/json',
    });
    expect(JSON.parse(file?.text ?? '')).toEqual(definition);
    expect(fileSize(file as NonNullable<typeof file>)).toMatch(/KB$/);
  });

  it('leaves other operations and outputs that do not parse alone', () => {
    expect(fileOf('records.get', { definition })).toBeUndefined();
    expect(fileOf('labware.export_opentrons', { definition: { nope: true } })).toBeUndefined();
  });
});

const at = '2026-10-07T00:00:00Z';
const plan = { id: `tfp_${'0'.repeat(26)}`, name: 'TFP-0001', version: 3 };
const storedFile = (suffix: string, filename: string) => ({
  id: `fil_${suffix.repeat(26)}`,
  kind: 'file',
  name: `FIL-000${suffix}`,
  label: filename,
  orgId: `org_${'0'.repeat(26)}`,
  labId: `lab_${'0'.repeat(26)}`,
  status: 'active',
  version: 1,
  attributes: {
    sha256: 'a'.repeat(64),
    size: 2450,
    mediaType: 'text/csv',
    originalName: filename,
    source: { from: 'export', record: plan.id, version: plan.version },
  },
  evidence: {},
  reviews: {},
  createdAt: at,
  updatedAt: at,
  createdBy: { type: 'user', userId: `usr_${'0'.repeat(26)}` },
  updatedBy: { type: 'user', userId: `usr_${'0'.repeat(26)}` },
});
const exported = {
  plan,
  files: [
    {
      group: 'dose',
      format: 'echo_pick_list',
      filename: 'dose.csv',
      file: storedFile('1', 'dose.csv'),
      rows: 4,
    },
    {
      group: 'backfill',
      format: 'worklist',
      filename: 'backfill.csv',
      file: storedFile('2', 'backfill.csv'),
      rows: 4,
    },
  ],
  skipped: [],
};

describe('filesOf', () => {
  it('returns each validated stored export file with its actual filename and byte count', () => {
    expect(filesOf('transfers.export', exported)).toEqual([
      { id: exported.files[0]?.file.id, name: 'dose.csv', size: 2450, group: 'dose' },
      { id: exported.files[1]?.file.id, name: 'backfill.csv', size: 2450, group: 'backfill' },
    ]);
    const [first] = filesOf('transfers.export', exported);
    expect(first && fileSize(first)).toBe('2 KB');
  });

  it('keeps deduplicated files from an earlier version or upload, using the stored download name', () => {
    const priorExport = {
      ...exported.files[0],
      filename: 'TFP-0001 v3 dose.csv',
      file: {
        ...exported.files[0]?.file,
        attributes: {
          ...exported.files[0]?.file.attributes,
          originalName: 'TFP-0001 v2 dose.csv',
          source: { from: 'export', record: plan.id, version: 2 },
        },
      },
    };
    const prior = filesOf('transfers.export', { ...exported, files: [priorExport] });
    expect(prior).toEqual([
      { id: exported.files[0]?.file.id, name: 'TFP-0001 v2 dose.csv', size: 2450, group: 'dose' },
    ]);
    const uploaded = filesOf('transfers.export', {
      ...exported,
      files: [
        {
          ...priorExport,
          file: {
            ...priorExport.file,
            attributes: { ...priorExport.file.attributes, source: { from: 'upload' } },
          },
        },
      ],
    });
    expect(uploaded).toEqual(prior);
  });

  it('rejects malformed stored output and retains inline exports', () => {
    expect(filesOf('transfers.export', { ...exported, plan: { ...plan, version: 'bad' } })).toEqual(
      [],
    );
    expect(
      filesOf('transfers.export', {
        ...exported,
        files: [{ ...exported.files[0], file: { ...exported.files[0]?.file, kind: 'sop' } }],
      }),
    ).toEqual([]);
    expect(
      filesOf('transfers.export', {
        ...exported,
        files: [{ ...exported.files[0], file: { ...exported.files[0]?.file, id: 'tfp_wrong' } }],
      }),
    ).toEqual([]);
    expect(
      filesOf('platemaps.export', { filename: 'plate.csv', csv: 'well,role\nA1,blank' }),
    ).toEqual([{ name: 'plate.csv', mediaType: 'text/csv', text: 'well,role\nA1,blank' }]);
  });
});
