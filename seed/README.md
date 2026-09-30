# Seed lab

One realistic, fictional lab that every agent, developer and test works against (plan 006). The catalog data is real: labware, instrument models, reagents and kits carry manufacturer catalog numbers and specs, each with its source. The lab itself (rooms, people, serial numbers, barcodes, lots) is made up.

The registries that load these files arrive one plan at a time (007 labware, 008 instruments, 009 reagents, 010 inventory, 011 SOP library). Each of those plans adds a loader for its file, validates it against its schemas and turns it into records. Until then the files are reviewed data, not loaded data.

## Files

| File | What it holds | Loaded by |
| --- | --- | --- |
| `lab.yaml` | The demo lab: org, lab, rooms, storage locations, people | 006 / 010b (rooms and storage as location proposals) |
| `labware.yaml` | Labware types (plates, tubes, reservoirs, tip racks) | 007 (`pnpm --filter @ailab/api seed`) |
| `instruments.yaml` | Research on the instrument models (sources, verified, estimated, unknown), then the demo lab's registered instruments and their configurations | 008 |
| `instrument-library.yaml` | Instrument and equipment kinds in the library's shape (mounts, sites, capabilities with limits), citing their `instruments.yaml` entries, and the demo lab's registered instruments with their configurations | 008a, 008b (`pnpm --filter @ailab/api seed`) |
| `reagents.yaml` | Research on reagent products and kits (sources, verified, estimated, unknown) | 009 |
| `reagent-library.yaml` | Products, kits and two lab-made buffers in the library's shape (typed handling rules, lot fields, recipes), the liquid types, and the demo lab's lots from `inventory.yaml` | 009a (`pnpm --filter @ailab/api seed`; lots arrive as proposals) |
| `liquid-classes.yaml`, `liquid-classes/` | Vendor default liquid classes: Opentrons' own class files (water, 50% glycerol, 80% ethanol) for the lab's Flex pipettes and filter tips, Hamilton's defaults for the lab's CO-RE II filter tips (from PyLabRobot, MIT), and the Echo calibrations | 009b (`pnpm --filter @ailab/api seed`) |
| `entities.yaml` | Research on cell lines, plasmids, compounds, enzymes | 010 |
| `entity-library.yaml` | The ten seed entity kinds (plasmid, DNA fragment, oligo, RNA, protein, antibody, enzyme, compound, cell line, bacterial strain) with their typed fields, and the demo lab's entities from `entities.yaml` in the library's shape | 010a (`pnpm --filter @ailab/api seed`) |
| `inventory.yaml` | Lots, and containers with what is in them and where they are | 009a (lots, via `reagent-library.yaml`) / 010b (containers as proposals; contents in 010c) |
| `sops/own/` | Short SOPs written for this lab, with their variables in front matter | 011 |
| `assays.yaml` | Assay templates that tie SOPs, labware, reagents and instruments together | 012 onward |
| `opentrons/` | Opentrons labware definitions the labware entries name, so well positions load offline | 007 |
| `worklists/` | Mock worklist and instrument report examples, one per instrument, until real exports exist | 016 (golden-file tests) |

Public SOPs, papers and vendor protocol PDFs for the SOP library are gathered separately (the SOP and literature test set) and kept in the project files, not here.

## Conventions

- **Keys, not IDs.** Records get their `lw_…`/`ins_…` IDs and readable names when they are loaded. In these files every item has a stable `key` (lowercase, hyphenated, e.g. `corning-3590`), and items refer to each other by key.
- **Units on every quantity:** `{ value: "300", unit: "uL" }`, with the value as a decimal string. Unit codes come from the unit registry in `packages/domain/src/units.ts`. Length (`mm`), wavelength (`nm`), speed (`rpm`) and centrifugal force (`xg`) are used here and are added to the registry by plan 007.
- **Provenance on every item:** `source_urls` lists where the values came from. `status` marks fields as `verified` (read from a primary source), `estimated` (reasoned, with a note) or `unknown`. Fields not listed in `status` are verified. Nothing is invented: an unknown catalog number stays unknown.
- **Conventions are labelled.** A handling rule that comes from a vendor says `source: vendor`; one that is lab practice (for example how long live cells may sit outside the incubator) says `source: lab_convention`.
- **Vendor documents** are usually copyrighted. They are linked by URL here, and any PDFs we keep live in the project files, not the repo.
