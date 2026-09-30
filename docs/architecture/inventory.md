# Inventory

What things are, and (from 010b) where they are and how much is left. Plan: [010](../plans/010-inventory.md). Decisions: [ADR 0029](../decisions/0029-entity-kinds-as-records.md).

## Where things live

| Concern | Code |
| --- | --- |
| Entity kind and entity schemas, field types, sequences, structures | `packages/schema/src/entities.ts` |
| Operation contracts | `packages/schema/src/operations/entities.ts` |
| Field checks, sequence checks, reverse complement, sequence search | `packages/domain/src/entities.ts` |
| Kinds and their related rules | `apps/api/src/entities/kinds.ts` |
| Operations | `apps/api/src/entities/operations.ts` |
| Agent skill | `skills/entities/SKILL.md` |

## Entity kinds (010a, V1)

An `entity_kind` (`enk_`, `ENK-0001`) has a base class from code, a readable prefix and typed fields:

| Base | Carries |
| --- | --- |
| `dna`, `rna` | a sequence of that alphabet (IUPAC codes allowed), linear or circular, with features |
| `protein` | an amino acid sequence with features |
| `chemical` | a structure: SMILES, InChIKey, molecular weight |
| `cells`, `organism`, `other` | fields only (live-cell rules come with 010d) |

Field types: `text`, `number` (with a unit, values in any unit of its dimension; without, a decimal string), `choice` (from options), `yes_no`, `date`, `url`, `link` (to a record of a kind, optionally only some entity kinds). A field can be `required`, which only matters for the final confirm.

The prefix is 2 to 5 capitals, not one a code kind holds (`PRD`, `LOT`, `INS`…) or another entity kind. Base and prefix are fixed once entities of the kind exist. Sections: Definition, Handling.

## Entities (010a)

An `entity` (`ent_`) is named with its kind's prefix (`PLS-0001`). It holds `fields` by key, a `sequence` or `structure` as its base allows, `synonyms`, `handlingRules` on top of its kind's, and `notes`. Sections: Identity, Handling.

The kind's `related` rules (ADR 0029) run on every write:

- refused: an unknown field key, a value of the wrong type, a quantity in a unit of the wrong dimension, a choice outside the options, a link to a record of the wrong kind or to an entity of a kind the field doesn't allow, sequence letters outside the alphabet, features past the end, a structure on a non-chemical entity, a change of kind;
- readiness blockers: the kind is still a draft; a required field is empty;
- readiness warning: the same sequence (exact, case ignored) or the same InChIKey as another entity.

Links: `is_a` to the kind, `refers_to` for each link field.

## Operations

| Operation | Does | Agents |
| --- | --- | --- |
| `entities.draft_kind` | Drafts an entity kind | direct (drafts) |
| `entities.draft` | Drafts an entity of a kind | direct (drafts) |
| `entities.search` | By text (name, readable name, synonym, text fields), kind, base, a field value, or a stretch of sequence (either DNA strand, across the origin of a circular one) | read |

Editing and confirming use `records.update` and review, which run the same checks.

## Not yet

Seed kinds and `seed/entities.yaml` (next), GenBank and FASTA import and export and molecular weight from SMILES (science service, V9), samples, containers, locations and barcodes (010b), contents and the ledger (010c), handling-rule inheritance (010d), screens (010e).
