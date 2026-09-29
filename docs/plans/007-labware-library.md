# 007: Labware library

- Status: round 1 accepted by Wali 2026-09-29 (L1 to L6 all as recommended). 007a built (ADR 0023): records operations replace the draft, update, get, search and confirm operations listed below.
- Depends on: 002 (records), 003 (operations), 004c (draft-and-confirm framework)
- Feeds: 008 (which labware fits which instrument site), 009 (liquid classes), 010 (physical plates and tubes), 012 (SOP variables such as dead volume), 014 (plate maps), 016 (transfers and worklists)

## What this plan delivers

A library of **labware types**: every plate, tube, rack, reservoir, tip rack and lid the lab uses, with the geometry and volumes that downstream work computes from. An agent drafts a new type from a catalog number, a datasheet or an Opentrons definition, marks what it assumed, and a person confirms it.

In the Kind, Instance, State rule this plan owns the **kind** (Corning 3570). The instance (barcoded plate PLT-0042) and its state (what is in each well, where it is, sealed or not) belong to inventory, plan 010 (see question L1).

## Starting point

- echo650-twin already has a reviewed labware catalog (`src/labware/data-vendor.js`, built by `scripts/build-labware-catalog.mjs`): about 40 definitions from Opentrons, Hamilton, Corning and NEST, with SBS geometry fields, capacities, materials and **field-level provenance** (which URL backs which fields, with a confidence). That is the right shape for rule 6 and becomes our seed and our model for provenance.
- Opentrons publishes a large open labware library (`shared-data/labware`, JSON with per-well x, y, z, depth, shape, diameter and volume). It is the widest public source of well geometry. Licence to be checked before import (the Opentrons repository is Apache-2.0 as far as I know).
- The seed-data thread is collecting real labware in parallel. This plan fixes the shape; that data is converted into it.

## Proposed model

**Labware type** (`lwt_`, readable `LWT-0001`), one record kind with a `family`:

| Family | Adds |
| --- | --- |
| plate | well grid, well shape, bottom, skirt, stacking height |
| reservoir | troughs (one or several), bottom shape |
| tube | one well, cap type, fits-in list (racks, adapters) |
| rack | positions that accept tube types (a rack holds labware, it has no liquid) |
| tip_rack | tip spec: nominal volume, filtered, length, which pipettes it fits |
| lid | height, which plates it fits |

Every type carries:

- **Identity:** plain name ("Corning 96-well flat clear, TC-treated"), manufacturer (a vendor record, shared with plan 009), catalog numbers (manufacturer and supplier, pack size), material, colour, surface treatment, sterile.
- **Geometry** (mm): outer footprint and height, footprint class (SBS/ANSI or tube diameter), wells (see L2), stacking offset, grip height for robots.
- **Volumes:** nominal well volume, maximum working volume, dead volume (see L4), and a volume-to-height model per well shape so liquid height, pipetting depth and "is there enough" can be computed.
- **Platform names:** what each instrument calls it (see L6).
- **Evidence:** each field group records its source (vendor datasheet with link, measured in our lab, imported from Opentrons, estimated by an agent) and confidence. Estimated fields render in agent ink until a person confirms them.

Pure logic lives in `packages/domain/labware`: well address parsing and ordering (row-wise and column-wise), generating wells from a grid, volume and height conversion per well shape, footprint compatibility, and dead-volume lookup. All unit tested.

## Operations (first cut)

| Operation | Agents |
| --- | --- |
| `labware.draft_type` from a description, catalog number or pasted datasheet text | direct (drafts) |
| `labware.import_opentrons` from an Opentrons labware JSON | direct (creates a draft) |
| `labware.update_type` | direct on drafts, proposed on active |
| `labware.confirm_type` (runs the readiness checks, then activates) | proposed |
| `labware.get_type`, `labware.search_types` (family, well count, vendor, catalog number, fits instrument) | read |
| `labware.wells` (computed well list with positions and volumes, for rendering and plate maps) | read |
| `labware.export_opentrons` | read |

## Screens

- **Labware library:** a dense list with filters (family, format, vendor, used in), and a top-down thumbnail of each type.
- **Labware type page:** a to-scale top view and a side cross-section of one well with the volume marks, specs in plain words, where it is used, and the evidence behind each value (expandable technical details for IDs and platform names).
- **Draft page:** the same view in design mode. The agent fills it in; the readiness panel shows what is ready for which use (manual work, Opentrons, Hamilton, Echo) and what is missing or assumed; confirm per section, then confirm the type.

## Round 1 answers

Wali chose the recommended option for L1 to L6 on 2026-09-29. On L6: nothing connects to instrument software yet. Platform names and the Opentrons export exist so that designs can be checked in simulation (our twins, plan 015, and Opentrons' own protocol simulator when worklists arrive in plan 016) before any hardware is involved.

## Round 1 questions (as asked)

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| L1 | Where do physical plates and tubes live? | A) 007 is types only; barcoded items, contents and location come with inventory (010) · B) 007 also registers physical items (barcode, location), 010 adds contents | **A.** A plate without its contents and location is not useful on its own, and one module should own barcodes and locations. 007 stays small and ships sooner. |
| L2 | How is well geometry stored? | A) A parametric grid (rows, columns, pitch, A1 offset, one well shape) that generates the wells, plus an explicit well list for irregular labware · B) Always an explicit per-well list, like Opentrons · C) Only rows, columns and volumes | **A.** A grid is what a datasheet gives and what a person can check; the explicit list covers odd reservoirs and racks. Both produce the same computed well list, which is lossless to and from Opentrons JSON. Well names are canonical `A1` (not `A01`) up to `AF48`; instrument file readers convert at the edge. |
| L3 | Which things count as labware? | A) Plates, reservoirs, tubes, tube racks, tip racks and lids in one kind with a family · B) Separate kinds per family · C) Plates only for now | **A.** One kind keeps search, compatibility and plate maps uniform, and tip racks are needed early because tip use drives scheduling and cost. Carriers, adapters and modules are instrument equipment (plan 008), not labware. |
| L4 | Where does dead volume live? | A) One value on the type · B) A default on the type plus per-instrument-kind values (Echo 384PP, STAR, manual pipetting), each with its source; liquid class refinements added in 009 · C) Only on liquid classes (009) | **B.** Dead volume really depends on who is pipetting from the plate: an Echo 384PP well and a hand-pipetted well differ. A digital SOP's diluent-volume variable then links to the exact value it used. |
| L5 | Where do specs come from when an agent drafts a type? | A) Import the Opentrons library and echo650-twin's reviewed catalog as seed, accept pasted or uploaded datasheets, and let the agent fill gaps from its own knowledge marked as estimated · B) Also give the in-app agent a web search and fetch tool so it can read vendor pages itself · C) Only what a person types | **A now, B as its own small plan.** A covers most common labware with real sources. Web access for the in-app agent is useful beyond labware (literature, vendor pages) and deserves its own decision; Claude Code already has it when you use it through MCP. |
| L6 | How do we connect to instrument software? | A) Store each platform's name for the type (Opentrons load name, Hamilton labware file name, Echo plate type) and export Opentrons JSON; don't generate Hamilton files · B) Also generate Hamilton labware files · C) Names only, no export | **A.** Opentrons definitions are open JSON we can validate. Hamilton labware files are proprietary and we can't check what we'd write, so we reference the lab's existing Hamilton definitions by name (rule 10: don't claim what isn't validated). |

## Defaults I'm assuming (say if any is wrong)

- Vendors and manufacturers are a small shared record kind (`vnd_`, `VND-0001`) created here and reused by instruments and reagents.
- Quantities follow plan 002: mm for geometry, µL for volumes, all as `Quantity`.
- A type used by any active record can't be edited in place: a change is a new version, and inventory items keep pointing at the type (history shows what changed).
- A 3D view waits for the twin port (015); 007 draws 2D.

## Proposed split

- **007a:** schema, domain geometry, operations, Opentrons and echo650 catalog import, seed labware.
- **007b:** library and type pages, agent draft and confirm with the readiness panel.
