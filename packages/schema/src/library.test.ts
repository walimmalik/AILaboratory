import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ExactSourceReference, SourceSnapshotContent } from './library.ts';
import { libraryRead } from './operations/library.ts';

const id = '01J9Z3K8Q4ABCDEFGHJKMNPQRS';
const source = {
  document: `doc_${id}`,
  version: 2,
  file: `fil_${id}`,
  sha256: 'a'.repeat(64),
  parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
  title: 'Method instructions',
};

describe('library snapshot contracts', () => {
  it('requires exactly one advertised read selector at runtime and in JSON Schema', () => {
    expect(libraryRead.input.safeParse({ document: source.document }).success).toBe(true);
    expect(libraryRead.input.safeParse({ source, passages: ['pas_1'] }).success).toBe(true);
    expect(libraryRead.input.safeParse({}).success).toBe(false);
    expect(libraryRead.input.safeParse({ document: source.document, source }).success).toBe(false);
    const schema = z.toJSONSchema(libraryRead.input);
    expect(schema.anyOf).toHaveLength(2);
    expect(schema.anyOf).toEqual([
      expect.objectContaining({ required: ['document'], additionalProperties: false }),
      expect.objectContaining({ required: ['source'], additionalProperties: false }),
    ]);
  });

  it('requires SHA256 identities and retains empty sections as content', () => {
    expect(ExactSourceReference.safeParse({ ...source, sha256: 'not-a-digest' }).success).toBe(
      false,
    );
    expect(
      ExactSourceReference.safeParse({ ...source, parse: { status: 'parsed', snapshot: 'latest' } })
        .success,
    ).toBe(false);
    expect(
      SourceSnapshotContent.parse({
        converter: 'test',
        warnings: [],
        outline: [{ index: 0, heading: ['Empty'], passages: 0 }],
        passages: [],
      }),
    ).toEqual({
      converter: 'test',
      warnings: [],
      outline: [{ index: 0, heading: ['Empty'], passages: 0 }],
      passages: [],
    });
  });
});
