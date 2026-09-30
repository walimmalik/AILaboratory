# Inventory

What things are, and (from 010b) where they are and how much is left. Plan: [010](../plans/010-inventory.md). Decisions: [ADR 0029](../decisions/0029-entity-kinds-as-records.md), [ADR 0030](../decisions/0030-locations-and-containers.md), [ADR 0031](../decisions/0031-well-contents.md).

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
| Well contents schema | `packages/schema/src/contents.ts` |
| Mixing math | `packages/domain/src/contents.ts` |
| Fill, transfer, consume, correct, wells, history; the ledger tables | `apps/api/src/inventory/contents.ts`, `well_contents`, `inventory_events`, `inventory_lines` |
| Agent skills | `skills/entities/SKILL.md`, `skills/inventory/SKILL.md`, `skills/calculators/SKILL.md` |

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

## Well contents (010c, V2 to V4)

A well holds a volume (or `"unknown"`) and components: samples (`smp_`) and lots (`lot_`), each with a concentration in the unit it came in, or an amount in a dry well. Mixing converts concentrations to amounts (concentration × volume), adds the same source in the same dimension, and divides by the new volume, in exact decimals. Molar, mass, activity, cell, colony, % v/v and % w/v concentrations mix; % w/w and anything without a concentration stay "present, concentration unknown". Taking more than a well holds is refused. Estimated contents are marked `assumed`, and the mark travels with the liquid. See ADR 0031.

## Samples (010c, V2)

A `sample` (`smp_`, `SMP-0001`) is a batch the lab made of an entity: a miniprep, midi or maxiprep, PCR product, digest, assembly, purification, culture, cell bank, extraction or synthesis. It carries when and by whom it was made, the samples or lots it was derived from, and its QC (`{key, value, measured?, method?}`, where the value is a quantity, yes/no or a short text; one entry per key). The QC belongs to the prep and is shared by all its aliquots. Bought things and recipe batches stay lots (009). Links: `is_a` the entity, `derived_from`. The entity can't change. `samples.register` creates it active; an agent's registration is a proposal.

## Volume ledger (010c, V4 and V7)

Every change to a well is an event in `inventory_events` (fill, transfer, stamp, consume, correct, discard) with its actor, operation and reason, and one line per well in `inventory_lines`: liquid `in` (with where it came from), `out` (with where it went) or `set` by a correction, with the well's state after. `well_contents` keeps each well's current state in the same transaction; empty wells have no row. Every inventory write first takes a per-lab transaction lock (`pg_advisory_xact_lock`), before it reads any well, so two operations on the same wells run one after the other instead of each writing its result over the other's. A tube or trough is well `A1`; racks, tip racks and lids hold no liquid. The ledger also refuses a negative volume and any component whose concentration isn't per volume (or a percent), whose amount isn't an amount, or which is negative, so a correction can't write what a fill couldn't. Lineage follows a well back from the line where liquid left it: earlier events, and earlier lines of the same event, so a stamp or transfer that empties a well and then refills it doesn't count the refill as an ancestor.

- Refused: taking more than a well holds (the whole event rolls back), filling past the labware type's `maxVolume`, a well the container doesn't have, a source that isn't a lot or sample in the lab, a discarded container.
- Warned: a well left below the labware type's dead volume.
- Agents' events are proposals (V7). Recording directly from an instrument run log comes with 022.

Stamping maps each source well onto a destination well: one to one (same grid), a quadrant (a plate into every other well of one with twice the rows and columns: 96 into 384, 384 into 1536; 1 starts at A1, 2 at A2, 3 at B1, 4 at B2) or an offset. The mapping is a calculator (`inventory.map_plates`, `mapPlates` in `@ailab/domain`), and the stamp is one event of paired out and in lines. Only wells holding something are stamped unless the wells are listed.

Lineage follows a well's `in` lines back: fills carry what went in (`added`), transfers and stamps name the source well, which is followed from the moment the liquid left it.

## Handling rules containers inherit (010d)

A container inherits the handling rules of what its wells hold: a lot brings its product's rules and storage temperature, a sample brings its entity's rules and its entity kind's. `inventory.effective_rules` merges them per rule type, the strictest winning (`mergeHandlingRules` and `mergeStorage` in `@ailab/domain`, ADR 0032):

| Rule | Strictest |
| --- | --- |
| Time limits: max time out of storage, use within, stable after opening or preparation | The shortest |
| Rests: equilibrate, reconstitute | The longest |
| Freeze-thaw limit | The fewest cycles |
| Keep cold, thaw, storage temperature | The narrowest range (highest minimum, lowest maximum); a conflict when they don't overlap |
| Read within, per step named in `after` | The narrowest window |
| Protect from light, mix before use, hygroscopic | Present once |
| Advice | Kept per text, never merged |

A merged rule is enforced when any of its sources is. Each effective rule lists every rule it came from: the record it is written on, the lots or samples that brought it, and their wells (as blocks like `A3:P22`). Rules can be read for some wells only. Enforced rules come first; the scheduler (019) keeps to them.

## Screens (010e)

Under **Inventory** in the Library (`apps/web/src/pages/Inventory.tsx`, helpers in `apps/web/src/lib/inventory.ts`):

- **Containers**, **Samples**, **Entities** and **Entity kinds**: record lists with their labware, place, kind or fields.
- **Places**: the location tree; picking a place lists everything under it with its path.
- **Scan** (under Lab, `apps/web/src/pages/Scan.tsx`): one field, focused on arrival, that takes any code a USB scanner types (readable names with or without the dash, printed codes) and shows the record and where it is. For a container it offers Move (scan the place or box, and a position for a box), Record use (wells and a volume per well) and Discard, each through its operation.
- An entity's page lists its samples.
- A container's page adds a **Wells** plate map. Above it, a key lists what the wells hold, one line per distinct mix (well count, contents with concentrations, wells as blocks like `A3:P22`, largest first); selecting a line leaves only those wells lit. When the mixes would take more than eight lines, a component found in fewer than 2% of the wells counts as "a different sample in each well", so a 1536-well library plate reads as its compounds in DMSO plus its control wells; past eight lines the rest fold under "N more mixes", and groups past the sixth share one quiet shade. Names come from `records.list` by `ids`, 500 at a time. The plate is shaded by contents (one data colour per key line, `--data-1` to `--data-6`) when the wells hold more than one mix and by volume otherwise, with a toggle between the two; volume shading is five steps against the fullest well (unknown volumes hatched, assumed contents outlined in agent ink). A search field picks a well by name or lights the wells whose contents match the text, and Export CSV downloads each well's volume and contents. A selected well's components and concentrations show beside the plate. It is drawn as in the bench console mockup: round wells at one pitch in a bounded grid, column and row labels centred on the wells, a key above and a line under it naming the well pointed at; plates wider than 12 columns use smaller wells, and a plate wider than the page scrolls on its own, a **Handling** block with the rules and storage temperature it inherits and where each comes from, and its **Ledger**. A box or rack shows what is in it instead.

## Operations

| Operation | Does | Agents |
| --- | --- | --- |
| `locations.create` | Adds a location | proposed |
| `inventory.register_containers` | Registers 1 to 96 containers of one labware type, all or none | proposed |
| `inventory.move` | Moves a container to a location or a box position; returns its place path | proposed |
| `inventory.scan` | Resolves a readable name (`plt000001`, `PLT-1` and `PLT-000001` all work) or an external code, with its place path | read |
| `inventory.list_place` | What is directly in a location or box, or everything under it with `deep` | read |
| `inventory.calculate_transfer` | Calculator: two wells after moving a volume between them | read |
| `inventory.fill` | Liquid or a dried amount into wells from outside the inventory (a lot or sample at a concentration) | proposed |
| `inventory.transfer` | Well-to-well moves, in order, mixed by the mixing math | proposed |
| `inventory.consume` | Liquid used up or thrown away | proposed |
| `inventory.correct` | Replace wells' contents with what was measured, with a reason | proposed |
| `inventory.discard` | Empties the wells in the ledger and marks the container discarded; a box must be emptied first | proposed |
| `samples.register` | A batch the lab made of an entity, with its QC | proposed |
| `inventory.map_plates` | Calculator: which source well lands on which destination well for a stamp | read |
| `inventory.stamp` | Plate to plate, the same volume per well, by a mapping | proposed |
| `inventory.lineage` | Where a well's liquid came from, back through fills, transfers and stamps | read |
| `inventory.wells` | What a container's wells hold | read |
| `inventory.where_is` | Every container holding a lot, sample or product (any of its lots), with its place path and the wells; shown as "Where it is" on lot, sample and product pages | read |
| `inventory.effective_rules` | The handling rules and storage temperature a container inherits from its contents, strictest winning, with sources | read |
| `inventory.history` | A container's or well's ledger, newest first | read |
| `entities.draft_kind` | Drafts an entity kind | direct (drafts) |
| `entities.draft` | Drafts an entity of a kind | direct (drafts) |
| `entities.search` | By text (name, readable name, synonym, text fields), kind, base, a field value, or a stretch of sequence (either DNA strand, across the origin of a circular one) | read |

Editing and confirming use `records.update` and review, which run the same checks. Locations are edited with `records.update`.

## Seed

`seed/entity-library.yaml` holds the ten seed kinds (plasmid `PLS`, DNA fragment `FRG`, oligo `OLI`, RNA `RNA`, protein `PRT`, antibody `AB`, enzyme `ENZ`, compound `CMP`, cell line `CEL`, bacterial strain `STR`) and the demo lab's entities from `seed/entities.yaml`: three ATCC cell lines, five plasmids (two fictional), staurosporine and DMSO linked to their products, and rSAP. Cell lines carry the lab's 30 min out-of-incubator rule on their kind. Loaded by `pnpm --filter @ailab/api seed` as drafts; the first source of each entity is the evidence for its fields, except those the research marked as estimates, which load as assumed. The FDA library waits for its plate map file (V10: one entity per compound).

The seed (`pnpm --filter @ailab/api seed`) turns the rooms and storage locations in `seed/lab.yaml` into locations and the containers in `seed/inventory.yaml` into registered containers, matched by label so it can run again. It runs as an agent, so each is a proposal, and something whose place is still waiting on Review waits for the next run: approve the rooms, run it again for the fridges and freezers, approve, run again for the containers. The HEK293 flask is skipped until a flask labware family exists.

The same run then registers the seed's samples (the two minipreps and the HEK293 culture), fills the containers from `fills` in `inventory.yaml` (lots by their lot number, samples by key), and stamps the assay-ready plate from the Echo source plate once that is filled (25 nL one to one). Each is a proposal that waits for what it needs: a container, its lots and samples, or the filled source plate. The pGL4.10 and rSAP tubes have no product or lot in the seed yet, so they keep their description and no contents.

## Not yet

GenBank and FASTA import and export and molecular weight from SMILES (science service, V9), samples, printing labels (a barcode library, and a check that the lab's readers accept the dash), flask and dish families, bulk import of an existing freezer list (V12). Entity kinds and entities are drafted and confirmed on the record page with its readiness panel. Rules from a recipe's ingredients and a kit's components (only the product's own rules count), freeze-thaw counting from location history, and rules that turn on or off with a step (after thawing, after opening) wait for the scheduler (019).
