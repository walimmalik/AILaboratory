import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { EntityAttributes, EntityBase, EntityKindAttributes, EntityKindId } from '../entities.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why; kept in history');
const Evidence = z
  .record(z.string(), EvidenceInput)
  .optional()
  .describe(
    'Where values came from, by attribute name, e.g. {"fields": {"source": "datasheet", "reference": "https://…"}}. Values you set without a source are marked assumed until a person confirms them',
  );

export const entitiesDraftKind = defineContract({
  id: 'entities.draft_kind',
  summary:
    'Draft a new kind of entity the lab registers (a nanobody, a gRNA, a patient sample…): its base class (dna, rna, protein, chemical, cells, organism, other), a readable prefix such as NBD, and its typed fields. A person confirms it before entities of the kind can be confirmed',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('The kind in plain words, e.g. "Nanobody"'),
    attributes: EntityKindAttributes,
    evidence: Evidence,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const entitiesDraft = defineContract({
  id: 'entities.draft',
  summary:
    "Draft an entity (a plasmid, cell line, compound, antibody…) of an entity kind: its fields by key, and a sequence (DNA, RNA, protein kinds) or structure (chemical kinds). Values are checked against the kind's fields; required ones may wait until confirmation. Readable names use the kind's prefix, e.g. PLS-0001",
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('Its name, e.g. "pGL4.10[luc2]"'),
    ...EntityAttributes.shape,
    fields: EntityAttributes.shape.fields.optional(),
    evidence: Evidence,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const entitiesSearch = defineContract({
  id: 'entities.search',
  summary:
    'Find entities by name, readable name, synonym or a text field, by kind or base class, by a field value, or by a stretch of sequence they contain. Each result names its kind',
  effect: 'read',
  input: z.strictObject({
    text: z
      .string()
      .min(1)
      .optional()
      .describe('Matches the name, readable name (PLS-0001), a synonym or any text field'),
    entityKind: EntityKindId.optional(),
    base: EntityBase.optional(),
    field: z
      .strictObject({ key: z.string().min(1), value: z.union([z.string(), z.boolean()]) })
      .optional()
      .describe('A field equal to this value, e.g. {"key": "resistance", "value": "ampicillin"}'),
    sequence: z
      .string()
      .min(3)
      .regex(/^[A-Za-z]+$/, 'letters only')
      .optional()
      .describe('A stretch of sequence the entity contains (either strand for DNA)'),
    status: z.enum(['draft', 'active']).optional().describe('Leave out for both'),
    limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
  }),
  output: z.object({
    entities: z.array(
      z.object({
        entity: RecordEnvelope,
        kind: z.object({ id: EntityKindId, name: z.string(), label: z.string(), base: EntityBase }),
      }),
    ),
    total: z.number().int().describe('How many matched before the limit'),
  }),
});
