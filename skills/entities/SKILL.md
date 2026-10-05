---
name: ailab-entities
description: Register what things are in AILaboratory (plasmids, cell lines, compounds, antibodies and new kinds of entity), with typed fields, sequences and structures, and find them, through its MCP tools.
---

# Entities in AILaboratory

An **entity kind** (`entity_kind`, `ENK-0001`) is a kind of thing the lab registers: plasmid, cell line, compound, or one the lab adds. It has a base class (`dna`, `rna`, `protein`, `chemical`, `cells`, `organism`, `other`), a readable prefix (`PLS`) and typed fields. An **entity** (`entity`) is one plasmid, cell line or compound, named with its kind's prefix (`PLS-0001`). Batches the lab makes of an entity are samples, and the tubes and plates holding them are containers: see the inventory skill.

## Finding

`entities.search` with `{text?, entityKind?, base?, field?: {key, value}, sequence?, status?}`. `text` matches the name, `PLS-0001`, synonyms and text fields; `sequence` finds entities containing a stretch (either strand for DNA, across the origin of a circular plasmid). Search before drafting, so the lab doesn't register the same plasmid twice. `records.list` with `kind: "entity_kind"` lists the kinds and their fields.

## Drafting an entity

During SOP/assay intake, draft necessary missing reusable entity definitions from current sources and explicit facts rather than sending the scientist through registry forms. Search for existing definitions first. An entity describes identity, not an actual specimen or stock: never fabricate samples, containers, measured QC or available volume to satisfy feasibility. Leave unknown facts absent, ask only the next consequential scientific question, and use calculators for scientific numbers. Unknown is not assent; human review and confirmation still apply.

`entities.draft` with `{label, entityKind, fields?, sequence?, structure?, synonyms?, handlingRules?, notes?, evidence?}`.

- `fields` are by key, as the kind defines them: text, a choice from its options, `true`/`false`, a date `"2026-09-30"`, a URL, a record ID for link fields, and for numbers either a quantity `{"value": "2686", "unit": "bp"}` (any unit of the field's dimension) or, for plain numbers, a decimal string `"500"`.
- DNA, RNA and protein kinds take `sequence: {alphabet, residues, topology?, features?}`; chemical kinds take `structure: {smiles, inchiKey?, molecularWeight?}`.
- Values that don't fit the kind are refused with the reason. Required fields may wait; readiness lists them, and they block the final confirm.
- Leave out what you don't know. Say where values came from in `evidence` (a datasheet or catalog page); anything you set without a source is marked assumed.
- A person confirms Identity and Handling. An entity of a kind that is still a draft can't be confirmed.

## Drafting a new kind

Only when no kind fits (look first). `entities.draft_kind` with `{label, attributes: {base, prefix, fields, handlingRules?, description?}}`. Pick a prefix of 2 to 5 capitals nobody uses. Keep fields to what the lab records about every such thing; mark a field `required` only if an entity is useless without it. A person confirms the kind. Its base and prefix are fixed once entities exist.
