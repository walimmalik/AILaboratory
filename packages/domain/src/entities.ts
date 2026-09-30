import type {
  EntityBase,
  EntityField,
  EntityFieldValue,
  EntitySequence,
  Quantity,
} from '@ailab/schema';
import { getUnit } from './units.ts';

/** Entity rules (plan 010a): fields checked against their kind, and sequences against their base. */

const isQuantity = (v: EntityFieldValue): v is Quantity => typeof v === 'object';
const DECIMAL = /^-?\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function unitDimension(code: string): string | undefined {
  try {
    return getUnit(code).dimension;
  } catch {
    return undefined;
  }
}

/** Problems with a kind's field list: repeated keys, units that don't exist. */
export function fieldDefinitionProblems(fields: EntityField[]): string[] {
  const problems: string[] = [];
  const keys = fields.map((f) => f.key);
  const repeated = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (repeated.length > 0) problems.push(`Field keys ${repeated.join(', ')} appear twice`);
  for (const f of fields) {
    if (f.type.type === 'number' && f.type.unit && !unitDimension(f.type.unit)) {
      problems.push(`${f.label}: "${f.type.unit}" is not a unit`);
    }
    if (f.type.type === 'choice' && new Set(f.type.options).size !== f.type.options.length) {
      problems.push(`${f.label}: an option appears twice`);
    }
  }
  return problems;
}

export interface FieldCheck {
  /** Values that can't be right for their field: refused. */
  invalid: string[];
  /** Required fields with no value: they only stop the final confirm. */
  missing: string[];
  /** Link fields' values, for the caller to check against the records they name. */
  links: { field: EntityField; id: string }[];
}

/** Checks an entity's field values against its kind's fields. */
export function checkEntityFields(
  fields: EntityField[],
  values: Record<string, EntityFieldValue>,
): FieldCheck {
  const result: FieldCheck = { invalid: [], missing: [], links: [] };
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) {
      result.invalid.push(
        `"${key}" is not a field of this kind${fields.length > 0 ? ` (its fields are ${fields.map((f) => f.key).join(', ')})` : ''}`,
      );
    }
  }
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) {
      if (field.required) result.missing.push(`${field.label} is required`);
      continue;
    }
    const problem = valueProblem(field, value);
    if (problem) result.invalid.push(`${field.label}: ${problem}`);
    else if (field.type.type === 'link') result.links.push({ field, id: value as string });
  }
  return result;
}

function valueProblem(field: EntityField, value: EntityFieldValue): string | undefined {
  const type = field.type;
  switch (type.type) {
    case 'text':
      return typeof value === 'string' ? undefined : 'give text';
    case 'yes_no':
      return typeof value === 'boolean' ? undefined : 'give true or false';
    case 'date':
      return typeof value === 'string' && DATE.test(value)
        ? undefined
        : 'give a date like 2026-09-30';
    case 'url':
      return typeof value === 'string' && /^https?:\/\/\S+$/.test(value)
        ? undefined
        : 'give a web address starting with https://';
    case 'choice':
      return typeof value === 'string' && type.options.includes(value)
        ? undefined
        : `choose one of ${type.options.join(', ')}`;
    case 'link':
      return typeof value === 'string' ? undefined : 'give the ID of a record';
    case 'number': {
      if (!type.unit) {
        return typeof value === 'string' && DECIMAL.test(value)
          ? undefined
          : 'give a number as text, like "2686"';
      }
      if (!isQuantity(value)) return `give a quantity like {"value": "1", "unit": "${type.unit}"}`;
      const want = unitDimension(type.unit);
      const got = unitDimension(value.unit);
      if (!got) return `"${value.unit}" is not a unit`;
      return got === want ? undefined : `give it in a unit like ${type.unit}, not ${value.unit}`;
    }
  }
}

const ALPHABETS = {
  dna: /^[ACGTNRYKMSWBDHV]+$/i,
  rna: /^[ACGUNRYKMSWBDHV]+$/i,
  protein: /^[ACDEFGHIKLMNPQRSTVWYBXZUO*]+$/i,
};
const ALPHABET_WORDS = {
  dna: 'A, C, G, T (and IUPAC codes)',
  rna: 'A, C, G, U (and IUPAC codes)',
  protein: 'the one-letter amino acid codes',
};

/** Which sequence a base class carries: DNA, RNA, protein, or none. */
export function sequenceAlphabet(base: EntityBase): 'dna' | 'rna' | 'protein' | undefined {
  return base === 'dna' || base === 'rna' || base === 'protein' ? base : undefined;
}

/** Problems with a sequence for an entity of this base class. */
export function sequenceProblems(sequence: EntitySequence, base: EntityBase): string[] {
  const alphabet = sequenceAlphabet(base);
  if (!alphabet) return [`A ${base} entity has no sequence`];
  const problems: string[] = [];
  if (sequence.alphabet !== alphabet) {
    problems.push(`The sequence is ${sequence.alphabet}, but this kind is ${alphabet}`);
  }
  if (!ALPHABETS[sequence.alphabet].test(sequence.residues)) {
    const bad = [
      ...new Set([...sequence.residues].filter((c) => !ALPHABETS[sequence.alphabet].test(c))),
    ];
    problems.push(
      `The sequence has ${bad.join(', ')}, which are not ${ALPHABET_WORDS[sequence.alphabet]}`,
    );
  }
  if (sequence.alphabet === 'protein' && sequence.topology) {
    problems.push('A protein sequence has no topology');
  }
  const length = sequence.residues.length;
  for (const f of sequence.features ?? []) {
    if (f.start > length || f.end > length) {
      problems.push(`Feature ${f.name} runs past the end (${length})`);
    } else if (f.end < f.start && sequence.topology !== 'circular') {
      problems.push(`Feature ${f.name} ends before it starts on a linear sequence`);
    }
  }
  return problems;
}

/** The residues as compared for duplicates: capitals only. */
export function sequenceKey(sequence: EntitySequence): string {
  return `${sequence.alphabet}:${sequence.residues.toUpperCase()}`;
}

const COMPLEMENT: Record<string, string> = {
  A: 'T',
  T: 'A',
  G: 'C',
  C: 'G',
  U: 'A',
  N: 'N',
  R: 'Y',
  Y: 'R',
  K: 'M',
  M: 'K',
  S: 'S',
  W: 'W',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
};

/** The reverse complement of a DNA stretch, in capitals. */
export function reverseComplement(dna: string): string {
  return [...dna.toUpperCase()]
    .reverse()
    .map((c) => COMPLEMENT[c] ?? c)
    .join('');
}

/**
 * Whether a sequence contains a stretch: either strand for DNA, and across the origin of a circular
 * sequence. Case doesn't matter.
 */
export function sequenceContains(sequence: EntitySequence, stretch: string): boolean {
  const residues = sequence.residues.toUpperCase();
  const target =
    sequence.topology === 'circular'
      ? residues + residues.slice(0, Math.max(0, stretch.length - 1))
      : residues;
  const wanted = stretch.toUpperCase();
  return (
    target.includes(wanted) ||
    (sequence.alphabet === 'dna' && target.includes(reverseComplement(wanted)))
  );
}
