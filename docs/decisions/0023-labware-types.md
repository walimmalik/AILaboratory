# 0023: Labware types as records

- Status: accepted
- Date: 2026-09-29
- Plan: 007 (round 1, L1 to L6; step 007a)

## Context

Plan 007 fixed the labware model in round 1 (types only, parametric grid plus explicit wells, one kind with families, dead volume on the type, seed from Opentrons and the seed lab, platform names with Opentrons export). It was written before draft and confirm (ADR 0021) and the Review page (ADR 0022) existed, so its operation list had its own draft, update, get, search and confirm operations. This ADR records how 007a fits the model onto what exists now.

## Options

1. **A record kind with sections and checks, plus a few labware operations** for what records can't do (Opentrons import and export, the computed well list). Drafting, editing, finding and confirming go through `records.*`, the same as every kind.
2. Labware-specific create, update and confirm operations as first listed in the plan. Two ways to do the same thing, against product rule 1.

## Decision

Option 1.

- **Kinds.** `labware_type` (`lwt_`, `LWT-0001`) and `vendor` (`vnd_`, `VND-0001`, shared with instruments and reagents later). A labware type links to its manufacturer (`made_by`).
- **One attribute per source.** Evidence is kept per top-level attribute, so values that come from different places are separate attributes: `footprint`, `wells`, `tip`, `maxVolume`, `workingVolume`, `deadVolume`, `opentronsLoadName`, `hamiltonLabware`, `echoPlateTypes`, and identity fields. Unknown keys are refused, so a typo is an error rather than lost data.
- **Sections:** Identity, Geometry (footprint, wells, tip), Volumes, Instrument names. Confirming the last one activates the type (ADR 0022).
- **Geometry is in mm, volumes in L, mL, µL or nL**, each a typed quantity. Wells are a `grid` (rows, columns, pitch, A1 centre from the left and back edges, one well shape) or an `explicit` list. Well names are canonical `A1` to `AF48`. `topHeight` keeps the height of well openings that sit below the labware's top, so Opentrons definitions round-trip without loss.
- **Checks.** Blockers: outer size known, wells laid out, maximum volume known, SBS well spacing (ANSI/SLAS 4-2004), volumes consistent. Warnings: SBS footprint (ANSI/SLAS 1-2004), well positions known, wells inside the footprint, well size known, maximum volume fits the computed well, dead volume known, tip length known, manufacturer and catalog number known. Each names its source.
- **Liquid height** is computed only for flat-bottomed wells (frustums, exact). Round and V bottoms are refused as not modelled until we have their profiles (product rule 10).
- **Opentrons.** `labware.import_opentrons` drafts a type from a schema-2 definition with every value marked imported; `labware.export_opentrons` writes one in the `custom_beta` namespace and says what is missing when it can't. Trash, adapters and lids are refused on import.
- **Seed.** `pnpm --filter @ailab/api seed` loads `seed/labware.yaml` through the operations as the agent "Seed loader": verified values carry datasheet evidence with the source URL, estimated values are assumed, unknown values are left out so readiness lists them.
- **Per-instrument dead volumes wait for plan 008.** L4 keeps a default on the type plus values per instrument kind; the per-instrument part links to instrument kind records, which arrive in 008.
- **echo650-twin's catalog** is not imported in 007a: the seed lab already covers the lab's labware with sources, and the catalog lives on Wali's laptop. It can be merged later through the same importer path.

## Consequences

- Every later registry follows this pattern: a kind with sections and checks, and operations only for what records can't express.
- Renaming or restructuring an attribute later means migrating stored records; the attribute layout above is the contract.
- The web app shows labware through the generic record pages until 007b adds the library and type pages.
