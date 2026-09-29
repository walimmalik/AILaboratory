import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileOf, fileSize } from './files.ts';

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
