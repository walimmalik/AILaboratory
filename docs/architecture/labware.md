# Labware

Labware types: the kind of every plate, reservoir, tube, rack, tip rack and lid (plan 007, ADR 0023). A physical, barcoded plate and what is in it belong to inventory (plan 010).

## Pieces

| Piece | Where |
| --- | --- |
| Attribute schema (families, footprint, well layout, volumes, instrument names), Opentrons definition schema | `packages/schema/src/labware.ts` |
| Operations: `labware.wells`, `labware.import_opentrons`, `labware.export_opentrons` | `packages/schema/src/operations/labware.ts`, `apps/api/src/labware/operations.ts` |
| Kinds `labware_type` and `vendor`, with sections and readiness checks | `apps/api/src/labware/kinds.ts` |
| Well names, computed wells, SBS rules, liquid height | `packages/domain/src/labware.ts` |
| Opentrons import and export | `packages/domain/src/opentrons.ts` |
| Seed loader for `seed/labware.yaml` | `apps/api/src/labware/seed.ts`, `apps/api/src/seed.ts` |
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

- Geometry is in mm; 1 mm³ is 1 µL.
- Well names are canonical (`A1`, not `A01`). `parseWellName` reads other spellings at the edge.
- Liquid height is computed for flat-bottomed wells only; other bottoms are refused as not modelled.
- The Opentrons export uses the type's load name, or one made from its label, in the `custom_beta` namespace. Hamilton labware files are referenced by name only (L6).

## Seed

`pnpm --filter @ailab/api seed` loads the seed lab's labware as drafts, running as the agent "Seed loader" for the only user (or `--user`). It is safe to run again: types whose label already exists are left alone. Entries that aren't labware (the Mantis chip) are skipped with the reason.
