# Inventory

What things are, and (from 010b) where they are and how much is left. Plan: [010](../plans/010-inventory.md). Decisions: [ADR 0029](../decisions/0029-entity-kinds-as-records.md), [ADR 0030](../decisions/0030-locations-and-containers.md).

## Where things live

| Concern | Code |
| --- | --- |
| Entity kind and entity schemas, field types, sequences, structures | `packages/schema/src/entities.ts` |
| Operation contracts | `packages/schema/src/operations/entities.ts` |
| Field checks, sequence checks, reverse complement, sequence search | `packages/domain/src/entities.ts` |
| Kinds and their related rules | `apps/api/src/entities/kinds.ts` |
| Operations | `apps/api/src/entities/operations.ts` |
| Location and container schemas, family prefixes | `packages/schema/src/inventory.ts` |
| Their operation contracts | `packages/schema/src/operations/inventory.ts` |
| Location and container kinds and their rules | `apps/api/src/inventory/kinds.ts` |
| Locations, registering, moving, scanning | `apps/api/src/inventory/operations.ts` |
| Agent skills | `skills/entities/SKILL.md`, `skills/inventory/SKILL.md` |

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

## Locations (010b, V6)

A `location` (`loc_`, `LOC-0001`) is a place that doesn't move: a room, fridge, freezer, cryostore, incubator, cold room, shelf, cabinet, bench or automated store. It sits inside a parent location, may carry a setpoint and CO2, and an automated store or incubator links to its instrument. The parent chain must exist and not loop. Links: `inside` the parent, `is_instrument`.

## Containers (010b, V5 and V6)

A `container` (`lw_`) is a barcoded plate, reservoir, tube, rack or box, tip rack or lid: an instance of a labware type. Its readable name is its lab barcode, with its family's prefix and six digits: `PLT-000001`, `RES-`, `TUB-`, `BOX-` (racks and freezer boxes), `TIP-`, `LID-`. Pre-barcoded labware keeps its own codes in `barcodes` (manufacturer, vendor or earlier system), unique in the lab.

A container sits in a location or in a position of a rack or box (`{container, position: "B3"}`), so moving a box moves what is in it. Rules on every write: the holder is a rack-family container whose type has that position; one container per position (discarded ones don't count); a box can't end up inside itself; the labware type exists and its family doesn't change. A draft labware type is a readiness warning. Status is in use, empty or discarded; containers are never deleted. Links: `is_a` the type, `stored_in` a location or `held_in` a box.

## Operations

| Operation | Does | Agents |
| --- | --- | --- |
| `locations.create` | Adds a location | proposed |
| `inventory.register_containers` | Registers 1 to 96 containers of one labware type, all or none | proposed |
| `inventory.move` | Moves a container to a location or a box position; returns its place path | proposed |
| `inventory.scan` | Resolves a readable name (`plt000001`, `PLT-1` and `PLT-000001` all work) or an external code, with its place path | read |
| `inventory.list_place` | What is directly in a location or box, or everything under it with `deep` | read |
| `entities.draft_kind` | Drafts an entity kind | direct (drafts) |
| `entities.draft` | Drafts an entity of a kind | direct (drafts) |
| `entities.search` | By text (name, readable name, synonym, text fields), kind, base, a field value, or a stretch of sequence (either DNA strand, across the origin of a circular one) | read |

Editing and confirming use `records.update` and review, which run the same checks. Locations are edited with `records.update`.

## Seed

`seed/entity-library.yaml` holds the ten seed kinds (plasmid `PLS`, DNA fragment `FRG`, oligo `OLI`, RNA `RNA`, protein `PRT`, antibody `AB`, enzyme `ENZ`, compound `CMP`, cell line `CEL`, bacterial strain `STR`) and the demo lab's entities from `seed/entities.yaml`: three ATCC cell lines, five plasmids (two fictional), staurosporine and DMSO linked to their products, and rSAP. Cell lines carry the lab's 30 min out-of-incubator rule on their kind. Loaded by `pnpm --filter @ailab/api seed` as drafts; the first source of each entity is the evidence for its fields, except those the research marked as estimates, which load as assumed. The FDA library waits for its plate map file (V10: one entity per compound).

## Not yet

GenBank and FASTA import and export and molecular weight from SMILES (science service, V9), samples, loading the seed lab's locations and containers, printing labels (a barcode library, and a check that the lab's readers accept the dash), flask and dish families, contents and the ledger (010c), handling-rule inheritance (010d), screens (010e).
