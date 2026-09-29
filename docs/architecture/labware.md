# Labware

Labware types: the kind of every plate, reservoir, tube, rack, tip rack and lid (plan 007, ADR 0023). A physical, barcoded plate and what is in it belong to inventory (plan 010).

## Pieces

| Piece | Where |
| --- | --- |
| Attribute schema (families, footprint, well layout, volumes, instrument names), Opentrons definition schema | `packages/schema/src/labware.ts` |
| Operations: `labware.wells`, `labware.import_opentrons`, `labware.export_opentrons`, `labware.use_standard_positions` | `packages/schema/src/operations/labware.ts`, `apps/api/src/labware/operations.ts` |
| Kinds `labware_type` and `vendor`, with sections and readiness checks | `apps/api/src/labware/kinds.ts` |
| Well names, computed wells, SBS rules, liquid height | `packages/domain/src/labware.ts` |
| Opentrons import and export | `packages/domain/src/opentrons.ts` |
| Seed loader for `seed/labware.yaml` and the Opentrons definitions in `seed/opentrons/` | `apps/api/src/labware/seed.ts`, `apps/api/src/seed.ts` |
| Skill | `skills/labware/SKILL.md` |

## Model

A labware type is a record of kind `labware_type` (`LWT-0001`). Its attributes are grouped into four review sections:

| Section | Attributes |
| --- | --- |
| Identity | `family`, `manufacturer` (a vendor record), `catalogNumber`, `otherCatalogNumbers`, `pack`, `material`, `color`, `surface`, `sterile`, `notes` |
| Geometry | `footprint` (SBS flag, length, width, height, tube diameter), `wells`, `tip` |
| Volumes | `maxVolume`, `workingVolume`, `deadVolume` |
| Instrument names | `opentronsLoadName`, `hamiltonLabware`, `echoPlateTypes` |

`wells` is either a grid (rows, columns, pitch, the centre of A1 measured from the left and back edges, and one well shape) or an explicit list of wells. A well shape has its opening (`top`: circular or rectangular), its base when tapered, its depth and its bottom (flat, round or v). `topHeight` is set only when well openings sit below the top of the labware.

Everything is optional except `family`, so an agent can draft what it knows; the readiness checks say what is missing, and blockers stop the last section's confirm from activating the type.

## Rules

- Each family is asked only what applies to it. A tube is its own single well: no pitch, A1 offset, SBS size or SBS checks; its outer size is diameter and height. Racks hold tubes, not liquid; tip racks have tip length and no dead volume; lids have no wells. `notApplicable` in `kinds.ts` lists the attributes each family is not asked for, and each check says which families it `applies` to.

- Geometry is in mm; 1 mm³ is 1 µL.
- Well names are canonical (`A1`, not `A01`). `parseWellName` reads other spellings at the edge.
- Liquid height is computed for flat-bottomed wells only; other bottoms are refused as not modelled.
- The Opentrons export uses the type's load name, or one made from its label, in the `custom_beta` namespace. Hamilton labware files are referenced by name only (L6).

## In the app

Library › Labware lists the types with a family filter (plates, tip racks, reservoirs, tubes…) and their format, manufacturer, catalog number and maximum volume. Vendors have their own page.

A labware type's page draws it to scale: from above, with its wells named, and one well cut through its centre, filled to the maximum volume when the bottom is flat. What the record doesn't give is drawn dashed and listed under the drawing (the SBS size, the standard spacing, a well size), so a draft still has a picture without the picture claiming values nobody entered.

## Seed

`pnpm --filter @ailab/api seed` loads the seed lab's labware as drafts, running as the agent "Seed loader" for the only user (or `--user`). It is safe to run again: types whose label already exists are left alone. Entries that aren't labware (the Mantis chip) are skipped with the reason.

The seed rarely says where wells sit. When an entry's Opentrons load name is verified and `seed/opentrons/` holds that definition (Apache-2.0, copied from Opentrons shared-data), the loader takes the pitch and A1 offset from it, and the well size too unless the seed's own is verified; the wells cite the definition's URL as datasheet evidence. A rerun gives types it made earlier the newer wells, as long as nobody entered or measured them (their evidence still cites the seed, or the standard positions below, which the labware's own definition supersedes). A draft changes at once; a confirmed type gets a proposal on the Review page for a person to approve, and a rerun doesn't propose it twice.

## Standard positions

`labware.use_standard_positions` sets the pitch and A1 offset of an SBS labware type to ANSI/SLAS 4-2004: 96 wells 9 mm apart with A1 at 14.38 mm from the left and 11.24 mm from the back, 384 wells 4.5 mm with A1 at 12.13 and 8.99 mm, 1536 wells 2.25 mm with A1 at 11.005 and 7.865 mm, and 12- or 24-trough reservoirs on the plate's columns, centred front to back (`sbsPositions` in `@ailab/domain`). The wells get `calculated` evidence citing the standard, so the note says to check them against the datasheet drawing. It refuses grids the standard doesn't place, labware not marked SBS, and a pitch that differs from the standard. The "Well positions are known" check offers it as a quick fix while it fails and the fix fits, and the review page shows it as a button.
