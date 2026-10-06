import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sopsDraft } from './operations/sops.ts';
import { SopAttributes } from './sops.ts';

const id = '01J9Z3K8Q4ABCDEFGHJKMNPQRS';
const source = {
  document: `doc_${id}`,
  version: 1,
  file: `fil_${id}`,
  sha256: 'a'.repeat(64),
  parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
  title: 'Instructions A',
};

describe('SOP source identity contract', () => {
  it('preserves absent, unbound and explicit exact roots without requiring inferred pins', () => {
    const a = { materials: [], variables: [], steps: [] };
    expect(SopAttributes.parse(a)).toEqual(a);
    const unbound = { ...a, source: { document: source.document, revision: 'Printed edition' } };
    expect(SopAttributes.parse(unbound)).toEqual(unbound);
    const exact = {
      ...a,
      source: { document: source.document, revision: 'Printed edition', exact: source },
    };
    expect(SopAttributes.parse(exact)).toEqual(exact);
    expect(sopsDraft.input.safeParse({ label: 'SOP', ...exact }).success).toBe(true);
    expect(
      SopAttributes.safeParse({
        ...a,
        source: { document: source.document, exact: { ...source, sha256: 'latest' } },
      }).success,
    ).toBe(false);
    const json = z.toJSONSchema(SopAttributes);
    expect(JSON.stringify(json)).toContain('snapshot');
  });
});
