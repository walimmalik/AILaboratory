# 0029: Entity kinds as records, checked through related rules

- Status: accepted
- Date: 2026-09-30
- Plan: 010

## Context

Plan 010, V1 (accepted by Wali on 2026-09-29): entity kinds (plasmid, cell line, compound, and kinds a lab adds later) are records built on a base class from code (dna, rna, protein, chemical, cells, organism, other) plus typed fields; an agent drafts a new kind and a person confirms it. Every other registry so far has a Zod schema in code that the record service validates on every write. An entity's fields can't be a Zod schema in code, because its kind lives in the database. Its readable name should also use its kind's prefix (`PLS-0012`, `CEL-0001`), not one prefix for all entities.

## Options

1. A kind hook the record service runs on every write and readiness read, with read access to records in the same lab: consistent everywhere (`records.create`, `records.update`, `records.restore`, confirm), one place for the rules.
2. Validate only in `entities.draft` and `entities.update` operations: `records.update` would then bypass the kind's fields.
3. Compile each entity kind into a Zod schema at startup and register it as a code kind: kinds added at runtime would need a restart, and a kind's fields could change under entities that already exist.

## Decision

Option 1. `KindDefinition.related(attributes, context)` returns problems that refuse the write, readiness checks (blockers stop the final confirm, warnings only show), and a readable name prefix for a new record. The service runs it inside the write's transaction; `context` reads records in the lab by ID or kind, the record as it was, and the prefixes code kinds hold.

- **Entity kind** (`enk_`, `ENK-0001`): base, prefix (2 to 5 capitals, not one a code kind or another entity kind holds), typed fields (text, number with a unit, choice, yes/no, date, url, link to a record of a kind, optionally only some entity kinds), handling rules. Sections: Definition, Handling. Base and prefix are fixed once entities of the kind exist.
- **Entity** (`ent_`, named with its kind's prefix): the kind, field values by key, a sequence (DNA, RNA, protein bases; alphabet, topology, features) or a structure (chemical: SMILES, InChIKey, molecular weight), synonyms, handling rules, notes. Sections: Identity, Handling. Values are checked against the kind on every write; an unknown key, a wrong type, a unit of the wrong dimension, a sequence letter outside the alphabet or a link to the wrong kind of record is refused. Required fields and a draft kind only block the final confirm. The kind can't change. Same sequence (exact, case ignored) or same InChIKey as another entity is a warning.
- Number fields with a unit take quantities in any unit of that dimension; `bp`, `kb`, `Mb`, `nt` and `aa` are now units.

## Consequences

- Any kind can later check itself against other records the same way (a container against its labware type, 010b).
- Readiness reads cost a few queries more for kinds with `related`; the list reads are per lab and fine at lab scale.
- Deferred to later 010 steps: GenBank and FASTA import and export, molecular weight and InChIKey from SMILES (science service, V9), sequence maps; flagging entities that no longer fit after their kind's fields change; `entities.where_used` (once containers and samples exist).
