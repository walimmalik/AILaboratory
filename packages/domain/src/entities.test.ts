import type { EntityField } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import {
  checkEntityFields,
  fieldDefinitionProblems,
  reverseComplement,
  sequenceContains,
  sequenceKey,
  sequenceProblems,
} from './entities.ts';

const fields: EntityField[] = [
  { key: 'resistance', label: 'Resistance', type: { type: 'text' }, required: true },
  { key: 'length', label: 'Length', type: { type: 'number', unit: 'bp' } },
  { key: 'copies', label: 'Copy number', type: { type: 'number' } },
  { key: 'bsl', label: 'Biosafety level', type: { type: 'choice', options: ['BSL-1', 'BSL-2'] } },
  { key: 'verified', label: 'Sequence verified', type: { type: 'yes_no' } },
  { key: 'received', label: 'Received', type: { type: 'date' } },
  { key: 'page', label: 'Page', type: { type: 'url' } },
  { key: 'parent', label: 'Parent', type: { type: 'link', kind: 'entity' } },
];

describe('checkEntityFields', () => {
  it('accepts values of the right type and lists links', () => {
    const result = checkEntityFields(fields, {
      resistance: 'ampicillin',
      length: { value: '2.686', unit: 'kb' },
      copies: '500',
      bsl: 'BSL-1',
      verified: true,
      received: '2026-09-30',
      page: 'https://www.neb.com/n3041',
      parent: 'ent_01J9Z3K8Q4ABCDEFGHJKMNPQRS',
    });
    expect(result.invalid).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.links.map((l) => l.id)).toEqual(['ent_01J9Z3K8Q4ABCDEFGHJKMNPQRS']);
  });

  it('refuses unknown keys and wrong values, and lists missing required fields', () => {
    const result = checkEntityFields(fields, {
      colour: 'blue',
      length: { value: '2', unit: 'mL' },
      copies: 'many',
      bsl: 'BSL-3',
      verified: 'yes',
      received: '30/09/2026',
      page: 'neb.com',
    });
    expect(result.missing).toEqual(['Resistance is required']);
    expect(result.invalid).toEqual([
      expect.stringContaining('"colour" is not a field of this kind (its fields are resistance'),
      'Length: give it in a unit like bp, not mL',
      'Copy number: give a number as text, like "2686"',
      'Biosafety level: choose one of BSL-1, BSL-2',
      'Sequence verified: give true or false',
      'Received: give a date like 2026-09-30',
      'Page: give a web address starting with https://',
    ]);
  });
});

describe('fieldDefinitionProblems', () => {
  it('finds repeated keys and unknown units', () => {
    expect(fieldDefinitionProblems(fields)).toEqual([]);
    expect(
      fieldDefinitionProblems([
        { key: 'a', label: 'A', type: { type: 'text' } },
        { key: 'a', label: 'A again', type: { type: 'number', unit: 'furlongs' } },
      ]),
    ).toEqual(['Field keys a appear twice', 'A again: "furlongs" is not a unit']);
  });
});

describe('sequenceProblems', () => {
  it('checks the alphabet, base and features', () => {
    expect(
      sequenceProblems(
        {
          alphabet: 'dna',
          residues: 'ATGCNatgc',
          topology: 'circular',
          features: [{ name: 'ori', type: 'rep_origin', start: 8, end: 2 }],
        },
        'dna',
      ),
    ).toEqual([]);
    expect(sequenceProblems({ alphabet: 'dna', residues: 'ATGU' }, 'dna')).toEqual([
      'The sequence has U, which are not A, C, G, T (and IUPAC codes)',
    ]);
    expect(sequenceProblems({ alphabet: 'protein', residues: 'MKV' }, 'dna')).toEqual([
      'The sequence is protein, but this kind is dna',
    ]);
    expect(sequenceProblems({ alphabet: 'dna', residues: 'ATG' }, 'chemical')).toEqual([
      'A chemical entity has no sequence',
    ]);
    expect(
      sequenceProblems(
        {
          alphabet: 'dna',
          residues: 'ATGC',
          features: [
            { name: 'a', type: 'CDS', start: 3, end: 1 },
            { name: 'b', type: 'CDS', start: 1, end: 9 },
          ],
        },
        'dna',
      ),
    ).toEqual([
      'Feature a ends before it starts on a linear sequence',
      'Feature b runs past the end (4)',
    ]);
    expect(sequenceKey({ alphabet: 'dna', residues: 'atgc' })).toBe('dna:ATGC');
  });
});

describe('sequenceContains', () => {
  it('finds a stretch on either strand and across the origin', () => {
    const plasmid = {
      alphabet: 'dna' as const,
      residues: 'GGGATCCAAA',
      topology: 'circular' as const,
    };
    expect(sequenceContains(plasmid, 'gatcc')).toBe(true);
    expect(sequenceContains(plasmid, 'TTGGATC')).toBe(true); // reverse strand of GATCCAA
    expect(sequenceContains(plasmid, 'AAAGG')).toBe(true); // across the origin
    expect(sequenceContains({ ...plasmid, topology: 'linear' }, 'AAAGG')).toBe(false);
    expect(reverseComplement('ATGC')).toBe('GCAT');
  });
});
