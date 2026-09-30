import { z } from 'zod';
import { recordIdOf } from './ids.ts';
import { LocalId } from './instruments.ts';
import { Quantity } from './quantity.ts';
import { HandlingRule } from './reagents.ts';

/**
 * Entities (plan 010a, V1 and V9): what things are. Entity kinds are records a lab adds to (plasmid,
 * cell line, compound, nanobody…), each built on a base class from code that brings behaviour
 * (sequences for DNA, RNA and protein, a structure for chemicals, live-cell rules for cells), plus
 * typed fields. Entities are the plasmids, cell lines and compounds themselves.
 */

export const EntityKindId = recordIdOf('enk');
export const EntityId = recordIdOf('ent');

export const EntityBase = z
  .enum(['dna', 'rna', 'protein', 'chemical', 'cells', 'organism', 'other'])
  .describe(
    'What it is underneath: dna and rna carry a sequence, protein an amino acid sequence, chemical a structure; cells and organism are alive',
  );
export type EntityBase = z.infer<typeof EntityBase>;

/** Which sequence alphabet a base class carries, if any. */
export const SEQUENCE_ALPHABET: Partial<Record<EntityBase, 'dna' | 'rna' | 'protein'>> = {
  dna: 'dna',
  rna: 'rna',
  protein: 'protein',
};

export const EntityFieldType = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text') }).describe('Free text, e.g. a resistance marker'),
  z
    .strictObject({
      type: z.literal('number'),
      unit: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Values are quantities measuring what this unit does (e.g. "bp", "g/mol", "h"), in any unit of it; leave out for a plain number',
        ),
    })
    .describe('A number, with a unit when it measures something'),
  z
    .strictObject({
      type: z.literal('choice'),
      options: z.array(z.string().min(1)).min(2).describe('The allowed values'),
    })
    .describe('One of a few values, e.g. BSL-1 or BSL-2'),
  z.strictObject({ type: z.literal('yes_no') }),
  z.strictObject({ type: z.literal('date') }).describe('A date like 2026-09-30'),
  z.strictObject({ type: z.literal('url') }).describe('A link to a web page'),
  z
    .strictObject({
      type: z.literal('link'),
      kind: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/)
        .describe('The record kind it points to, e.g. "entity", "product" or "vendor"'),
      entityKinds: z
        .array(EntityKindId)
        .optional()
        .describe('For links to entities: which entity kinds are allowed (e.g. only plasmids)'),
    })
    .describe('A link to another record, e.g. a parent plasmid or the vendor product'),
]);
export type EntityFieldType = z.infer<typeof EntityFieldType>;

export const EntityField = z.strictObject({
  key: LocalId.describe('The key values are stored under, e.g. "resistance"'),
  label: z.string().min(1).describe('In plain words, e.g. "Resistance marker"'),
  type: EntityFieldType,
  required: z
    .boolean()
    .optional()
    .describe('Needed before an entity of this kind can be confirmed'),
  description: z.string().min(1).optional(),
});
export type EntityField = z.infer<typeof EntityField>;

export const EntityKindAttributes = z.strictObject({
  base: EntityBase,
  prefix: z
    .string()
    .regex(/^[A-Z]{2,5}$/, 'must be 2 to 5 capital letters, like PLS')
    .describe('Readable name prefix for its entities, e.g. PLS gives PLS-0001'),
  fields: z.array(EntityField).describe('The typed fields every entity of this kind has'),
  handlingRules: z
    .array(HandlingRule)
    .optional()
    .describe('Rules for every entity of this kind, e.g. time out of the incubator for cells'),
  description: z.string().min(1).optional(),
});
export type EntityKindAttributes = z.infer<typeof EntityKindAttributes>;

/** A field's value: text, choice, date, url or link as a string; a number as a quantity or a decimal. */
export const EntityFieldValue = z.union([z.string().min(1), Quantity, z.boolean()]);
export type EntityFieldValue = z.infer<typeof EntityFieldValue>;

export const SequenceFeature = z.strictObject({
  name: z.string().min(1),
  type: z
    .string()
    .min(1)
    .describe('GenBank feature type, e.g. CDS, promoter, rep_origin, misc_feature'),
  start: z.number().int().min(1).describe('First base or residue, counting from 1'),
  end: z.number().int().min(1).describe('Last one; on a circular sequence it may be before start'),
  strand: z.enum(['forward', 'reverse', 'none']).optional(),
});

export const EntitySequence = z.strictObject({
  alphabet: z.enum(['dna', 'rna', 'protein']),
  residues: z
    .string()
    .min(1)
    .regex(/^[A-Za-z*]+$/, 'letters only, no spaces or numbers')
    .describe('The sequence, 5′ to 3′ or N to C'),
  topology: z.enum(['linear', 'circular']).optional().describe('DNA: plasmids are circular'),
  features: z.array(SequenceFeature).optional(),
});
export type EntitySequence = z.infer<typeof EntitySequence>;

export const EntityStructure = z.strictObject({
  smiles: z.string().min(1).regex(/^\S+$/, 'one SMILES string, no spaces'),
  inchiKey: z
    .string()
    .regex(/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/, 'must be an InChIKey like BSYNRYMUTXBXSQ-UHFFFAOYSA-N')
    .optional(),
  molecularWeight: Quantity.optional().describe('In g/mol'),
});
export type EntityStructure = z.infer<typeof EntityStructure>;

export const EntityAttributes = z.strictObject({
  entityKind: EntityKindId.describe('What kind of thing it is; fixed once created'),
  fields: z.record(LocalId, EntityFieldValue).describe("Values for the kind's fields, by key"),
  sequence: EntitySequence.optional().describe('DNA, RNA and protein kinds'),
  structure: EntityStructure.optional().describe('Chemical kinds'),
  synonyms: z.array(z.string().min(1)).optional().describe('Other names it goes by'),
  handlingRules: z
    .array(HandlingRule)
    .optional()
    .describe("Rules for this entity on top of its kind's, e.g. a stricter time out of storage"),
  notes: z.string().min(1).optional(),
});
export type EntityAttributes = z.infer<typeof EntityAttributes>;
