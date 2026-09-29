# 010: Inventory

- Status: accepted. Round 1 (V1 to V6) accepted by Wali 2026-09-29, all as recommended. Round 2 (V7 to V12) accepted 2026-09-29, all as recommended. Ready to build after 009a.
- Depends on: 002 (records, units, exact decimals, links), 003 (operations), 004c (draft-and-confirm), 007 (labware types, dead volumes, well geometry), 008 (instrument storage sites, pipetting devices), 009 (products, lots, recipes, handling-rule vocabulary)
- Feeds: 012 (SOP variables that read a container's contents), 013 (experiments use samples), 014 (plate maps name samples and lots), 016 (transfer plans execute as inventory transfers), 019 (scheduler reads the effective handling rules of each plate), 020 (analysis joins reads to well contents), 021 (notebook timeline)

## What this plan delivers

The lab's physical stock and what it is, like Benchling's registry and inventory or FreezerPro, deep-linked to the other registries:

- **Entity registry:** what things are. Plasmids, DNA fragments, backbones, oligos, RNA, proteins, antibodies, enzymes, compounds, cell lines, bacterial strains, and kinds the lab adds later, with typed fields, sequences and structures.
- **Samples:** batches the lab made of an entity (a miniprep, a purified protein, a cell bank, a PCR product), with their QC.
- **Containers:** barcoded plates, tubes, flasks, reservoirs, racks and boxes, each an instance of a labware type (007), with what is in every well.
- **Locations:** rooms, fridges, freezers, shelves, racks, boxes and positions, plus instrument storage sites such as the Cytomat (008).
- **Barcode service:** issue, print, scan and resolve barcodes, including pre-barcoded tubes and plates.
- **Volume ledger:** every fill, transfer, stamp, consumption, discard and correction, with exact volumes and full lineage from well to well.
- **Handling rules inherited by containers:** a plate holding HEK293 cells gets "max 30 min out of the incubator, from HEK293 cell line kind"; the strictest rule wins and every rule shows its source (000 idea 1.7).

In the Kind, Instance, State rule: entity kinds and entities are kinds and identities; samples and containers are instances; well contents, volumes and locations are state. Lots stay in 009 (R1); this plan owns the containers that hold them.

## Starting point

- `seed/entities.yaml`: 3 ATCC cell lines, 5 plasmids (2 fictional), 3 compounds (one is the FDA library as a single item), 1 enzyme, with handling rules half-typed.
- `seed/inventory.yaml`: 22 lots (009 loads them) and 9 containers: a HEK293 flask, a staurosporine stock tube, an Echo source plate with 320 library compounds plus controls, an assay-ready plate stamped from it, a coated ELISA plate, three plasmid tubes and an enzyme tube. Barcodes are placeholders (`DL` + 6 digits) waiting for V5.
- `seed/lab.yaml`: 4 rooms and 7 storage locations (fridge, -20, -80, LN2 dewar, TC incubator, shelf, flammables cabinet).
- Gaps found in the seed: the T75 flask has no labware type (007 has no flask or dish family yet); the FDA library is one entity instead of one per compound; the ELISA plate lists no contents; the assay-ready plate has no volumes.
- 009 already decided that lab-made solutions (Reagent Diluent, complete medium, 10 mM compound stocks) are recipe lots, and that a mixture's liquid type is computed from its contents (R8). Both depend on this plan's contents model.
- 002 decided exact decimals for every quantity (T2), which the ledger relies on.

## Proposed model

| Layer | Record | Holds |
| --- | --- | --- |
| Kind | **Entity kind** (`enk_`, `ENK-0001`), see V1 | Base class, typed fields, readable prefix (PLS, CMP, CEL…), default handling rules, which fields are required to confirm |
| Kind | **Entity** (`ent_`, readable per kind: `PLS-0012`, `CMP-0003`, `CEL-0001`) | The kind's fields, sequence or structure, links (parent plasmid, backbone, insert, vendor product), handling rules that tighten the kind's |
| Instance | **Sample** (`smp_`, `SMP-0001`), see V2 | Entity, how it was made (prep, purification, culture, derived from), QC values (concentration, sequence verified, passage, purity), who and when |
| Instance | **Container** (`lw_`, readable per family: `PLT-`, `TUB-`, `FLK-`, `RES-`, `BOX-`), see V5 and V6 | Labware type, barcodes, location and position, sealed or lidded, status (in use, empty, discarded) |
| Kind/Instance | **Location** (`loc_`, `LOC-0001`) | Tree node (room, fridge, freezer, shelf, rack), setpoint, optional grid, link to an instrument site for automated stores |
| State | **Well contents** | Per well: components (sample or lot) with amount and concentration, total volume, computed liquid type (009 R8), effective handling rules |
| State | **Ledger entry** | One fill, transfer, stamp, consume, discard, move or correction: from which wells, to which wells, how much, operation, actor, time |

Pure logic in `packages/domain/inventory`: mixing math (C1V1, concentrations after a transfer, exact decimals), plate-to-plate mappings (1:1, 4 x 96 into 384 by quadrant, 384 into 1536, row and column offsets), strictest-rule merging of handling rules, freeze-thaw counting from location history. All unit tested.

## Operations (first cut, adjusted once decisions are made)

| Operation | Agents |
| --- | --- |
| `entities.draft_kind`, `entities.confirm_kind` | direct (drafts), confirm proposed |
| `entities.draft`, `entities.update`, `entities.confirm` (from a description, GenBank file, SMILES or catalog item) | direct on drafts, proposed on active |
| `entities.search` (by name, kind, field, sequence or structure), `entities.get`, `entities.where_used` | read |
| `samples.register` (a prep of an entity, with QC) | proposed |
| `inventory.register_containers` (one or many, from a labware type, with barcodes and location) | proposed |
| `inventory.fill` (put a sample or lot into wells), `inventory.transfer` (well to well list), `inventory.stamp` (plate to plate with a mapping), `inventory.consume`, `inventory.discard` | see round 2 |
| `inventory.move` (to a location or box position), `inventory.set_seal` | see round 2 |
| `inventory.correct` (record a measured volume or contents, with a reason) | proposed |
| `inventory.scan` (resolve any barcode to its record), `inventory.print_labels` | read |
| `inventory.get_container`, `inventory.wells`, `inventory.lineage`, `inventory.search` (what, where, how much, expiring), `inventory.effective_rules` | read |
| `locations.create`, `locations.update` | proposed |

## Screens

- **Inventory browser:** the location tree on the left, a freezer box or rack as a grid of positions, a plate as a well grid with contents and volumes as a heat map.
- **Container page:** the plate or tube with every well's contents, volume, liquid type and effective handling rules (with sources), lineage back through transfers and stamps, and its move and ledger history.
- **Entity page:** fields in plain words, sequence map or structure, samples and every container holding it with amounts and locations, where it is used.
- **Scan:** one field that accepts any barcode (USB scanners type into it) and opens the record, with quick actions (move, consume, discard).
- **Drafts:** entity kinds, entities and bulk imports in design mode with the readiness panel.

## Round 1 questions

Recommended option in bold.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| V1 | How are entity kinds defined (the "entity schema builder")? | A) Kinds are records. Each is built on one base class from code (DNA, RNA, protein, chemical, cells, organism, other) that brings behaviour (sequence tools, molecular weight, live-cell rules), plus typed fields (text, number with a unit dimension, choice, link to a record, sequence, structure). Plasmid, DNA fragment, oligo, RNA, protein, antibody, enzyme, compound, cell line and bacterial strain ship as seed kinds; an agent drafts a new kind and a person confirms it · B) Every kind is a Zod schema in `packages/schema`, so a new kind is a code change · C) One generic entity with free-form fields | **A.** A lab adds kinds all the time (nanobodies, gRNAs, patient samples), and "agents can do what people can" rules out B. The field-type vocabulary itself stays in `packages/schema` (schemas first), and 000 already planned JSONB attributes validated against the kind. Changing an active kind makes a new version and flags entities that no longer validate. |
| V2 | What sits between "what it is" and "what is in the tube"? | A) Three layers: entity (pGL4.10, HEK293), then a sample (a miniprep, a purified protein, a cell bank, a PCR product, with its QC) or a lot (bought, or made from a 009 recipe), then container contents (how much of which sample or lot is in which well) · B) No sample layer: contents point at the entity and carry per-tube notes · C) Every aliquot is its own sample record, as in Benchling | **A.** QC (sequence verified, Qubit concentration, passage) belongs to the prep and is shared by all its aliquots; B loses that, and C makes 384 records per plate. The split with 009: bought things and recipe batches are lots; things the lab produces by biology or purification are samples. |
| V3 | How much does a well know about what is in it? | A) Full composition: each well lists its components (samples and lots, and through recipes their ingredients) with amount and concentration, recomputed by mixing math on every transfer, with lineage back to the source wells · B) Labels only; concentrations typed by hand · C) Only the direct source well; compute on demand | **A.** Dose-response needs the final concentration per well, 009 R8 computes the liquid type from contents (0.5% DMSO), and handling rules flow from contents. Exact decimals (002 T2) keep it from drifting. |
| V4 | Volume ledger rules | A) Every change to a well is a ledger entry (fill, transfer, stamp, consume, discard, correction) with actor and operation, and the current well state is updated in the same transaction. A volume can't go below zero (refused); going below the dead volume for the instrument that will pipette it (007 L4) is a warning; "volume unknown" is allowed for items registered without one; a measured value replaces the computed one with a reason · B) Keep only current state and rely on record version snapshots · C) Track presence, not volume | **A.** Snapshotting a 384-well plate on every transfer is heavy and can't answer "where did this volume go". The ledger gives lineage, undo and the notebook timeline; plate metadata (location, seal, status) still uses normal record versions. |
| V5 | Barcode format | A) A container's readable name is its lab barcode (`PLT-000345`, Code 128 on plate sides for the STAR, Vantage and Echo readers, DataMatrix on tube lids); pre-barcoded labware (Matrix or FluidX tubes, vendor-barcoded plates) keeps its own code as an extra barcode that also resolves; one scan finds either · B) A separate lab barcode series (for example `DL` + 6 digits) unrelated to readable names, plus external codes · C) Only pre-printed and vendor barcodes | **A.** One identifier to read, write and scan, and T5 already made names short and barcode-friendly. B adds a second number for every item with nothing gained. Before building I check your readers' barcode settings (Venus barcode masks, Echo) accept the dash; if not, the printed code drops it. |
| V6 | How are locations and holders modeled? | A) A location tree for things that don't move (room, fridge, freezer, shelf, rack slot); things that move and hold other things (freezer boxes, SBS tube racks) are containers with a grid from their labware type, so a tube sits in B3 of `BOX-0012` on shelf 2 of Freezer -80 1. Automated stores and incubators (Cytomat) appear in the tree as their 008 storage sites · B) Boxes are locations too · C) Free-text location | **A.** Boxes and racks move between freezers and onto robot decks as one unit, so they must be physical items; moving a box moves everything in it. Freezers don't move. |

## Round 1 answers

Wali chose A for V1 to V6 on 2026-09-29.

## Round 2 answers

Wali chose A for V7 to V12 on 2026-09-29.

- **V7:** Wali wants agents to earn more autonomy as evidence builds up. So the agent policy for physical events is resolved in one place (003's policy resolver) per scenario, such as "move requested in the same conversation" or "consume recorded by a run log", and the ledger keeps, per scenario, how often agent proposals were confirmed unchanged, edited or rejected. When a scenario's record is good enough, a person can switch it to auto-confirm; the switch is itself a recorded, reversible setting. No scenario auto-confirms at launch.

## Round 2 questions

Recommended option in bold.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| V7 | Who may record physical events (fill, transfer, stamp, consume, move, discard)? | A) People record directly. An agent's record is a proposal a person confirms, unless it comes from an instrument run log (022) or a run the person started · B) Agents record directly, like people · C) Everything is proposed, people included | **A.** The inventory must match the bench; an agent can't see the bench, so its claims need a person, but a run log is evidence. Moving a container is the exception: agents may move records directly when a person asked them to in the same conversation. |
| V8 | Do confirmed plans reserve stock? | A) Soft reservations: a confirmed experiment or transfer plan reserves the volume it needs; pickers show "available = current minus reserved"; over-committing is a readiness warning, not a block; reservations end when the run is recorded or the plan is cancelled · B) Hard reservations that block · C) No reservations | **A.** Two plans counting on the same 40 µL is the classic failure, but a small lab often knows better than the numbers, so warn instead of block. |
| V9 | How deep do sequences and structures go in 010? | A) Store DNA, RNA and protein sequences with features; GenBank and FASTA import and export through the science service (Biopython); a read-only linear and circular map; compounds store SMILES, InChIKey and molecular weight (RDKit); duplicate warnings by sequence hash and InChIKey. Construct design (Gibson, Golden Gate) waits for its own plan · B) Plain sequence text and SMILES only · C) A full sequence editor and construct designer now | **A.** Molecular weight is needed for mass-to-molar conversion (002), and duplicates are the first thing a registry must catch. Editing and assembly design are a big plan of their own. |
| V10 | How are compound libraries registered? | A) One entity per compound, imported from the vendor's plate map file (name, CAS, SMILES, well, concentration), grouped in a library record; library plates are containers whose wells hold those compounds · B) One entity for the whole library, wells labeled by name · C) Import only the compounds you pick | **A.** Hits, dose-response follow-ups and analysis are per compound, and a library entity can't say which one was in well C7. The seed's FDA library becomes one entity per compound. |
| V11 | How much cell culture tracking? | A) Culture flasks carry passage number and observations (confluence, viability, cell count with cells/mL); a passage operation makes derived flasks at passage plus one; cryopreserved banks are samples with vials; mycoplasma test results are QC on the sample · B) Passage number only · C) Full cell-bank management (master and working banks, release testing) now | **A.** The scheduler and plate maps need the passage and live-cell rules, and seeding density needs a count. Formal bank release is more than an academic lab needs now; A leaves room for it. |
| V12 | How does an existing freezer list get in? | A) An agent reads a spreadsheet or CSV (any columns), matches rows to entity kinds, labware types and locations, and drafts an import; the readiness panel shows unmatched rows, guessed values (marked assumed) and duplicates; a person confirms and it registers everything in one transaction · B) A fixed CSV template people fill in · C) Manual entry only | **A.** This is exactly the "agent drafts, person confirms" job, and it is how your academic lab's real inventory will arrive. A template can still exist as the agent's target shape. |

## Also decided as defaults (say if any is wrong)

- 010 records transfers and stamps, whether done by hand or by a run; 016 designs transfer plans and calls these operations when a plan runs.
- Freeze-thaw cycles are counted from location history (out of a freezer at or below -20 °C and back), and can be corrected by hand. Time out of controlled storage is recorded from moves; the scheduler (019) turns it into exposure.

## Defaults I'm assuming (say if any is wrong)

- 007 gains `flask` and `dish` labware families (T75, T175, 10 cm dish) so cell culture vessels are labware types like everything else.
- Receiving a lot (009 `reagents.receive_lot`) can create its containers here in the same step ("3 vials into Fridge 1").
- Amounts can be volume, mass or count (cells, colonies); powders and dried plates are allowed without a volume.
- USB barcode scanners work as keyboard input in the scan field; phone camera scanning comes later.
- Labels print as a PDF sheet now; a label printer (Zebra ZPL or similar) is added once the lab's printer model is known.
- Prices, ordering and reorder points stay out of scope, as in 009.
- Containers are never deleted once active: empty and discarded are statuses, and their ledger stays readable.
- The seed's `DL` barcodes are replaced by whatever V5 decides.

## Proposed split

- **010a:** entity kinds and entities, seed kinds, loader for `entities.yaml`.
- **010b:** locations, containers, barcode service, loader for `lab.yaml` locations and the containers in `inventory.yaml`.
- **010c:** well contents, the volume ledger, fill, transfer, stamp, consume, correct, mixing math and lineage.
- **010d:** handling-rule inheritance into containers and `inventory.effective_rules` for the scheduler.
- **010e:** inventory browser, container, entity and scan pages, agent drafting with the readiness panel.
