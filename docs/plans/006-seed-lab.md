# 006: Seed lab

- Status: round 6 answered by Wali 2026-09-29; first cut of the data written, in review
- Depends on: 000 (Kind, Instance, State; units; readable IDs)
- Feeds: 007 labware, 008 instruments, 009 reagents, 010 inventory, 011 SOP library, and every e2e test

## What it delivers

One realistic lab that every agent, developer and test works against: real labware catalog items, real instrument models, real reagents and kits, a few SOPs, and two assay templates (ELISA and a compound dose-response screen). Specs come from manufacturer pages and datasheets, and every value says whether it was verified from a source, estimated, or unknown.

The registries that load this data (plans 007 to 010) don't exist yet. So this plan writes the data first, as reviewed data files in `seed/`, and each registry plan adds its loader and turns its slice into records. That keeps the data work off the agent panel code (plan 004b) that another thread is building.

## What the first cut contains

- `seed/lab.yaml`: the fictional Demo Lab (4 rooms, 7 storage locations, 4 people).
- `seed/labware.yaml`: 33 labware types.
- `seed/instruments.yaml`: 16 instrument kinds from Wali's list and 18 registered demo instruments; STAR, VANTAGE, FeliX, qTOWER3 and PTC Tempo configurations confirmed by Wali, the rest marked assumed.
- `seed/reagents.yaml`: 28 products and kits with storage and handling rules.
- `seed/entities.yaml`: 3 ATCC cell lines, 5 plasmids (2 fictional demo constructs), 3 compounds, 1 enzyme.
- `seed/inventory.yaml`: 22 lots and 9 containers (cells, compound stocks, an Echo source plate, an assay-ready plate, a coated ELISA plate, minipreps).
- `seed/sops/own/`: 11 short SOPs with variables.
- `seed/assays.yaml`: 6 templates (ELISA, single-point screen, dose-response with CellTiter-Glo or HiBiT, pNPP kinetic, Dual-Glo, plasmid assembly).

## Research scope at the start

- Labware: about 25 types (ELISA and cell plates, Echo source plates, deep-well, PCR, reservoirs, tubes, Hamilton and Opentrons tips) with catalog numbers, geometry, max and dead volumes, and the Opentrons or Hamilton definition name where one exists.
- Instruments: kind-level specs for Hamilton STAR, Opentrons Flex and OT-2, Echo 650, three plate reader candidates, and support equipment (sealer, centrifuge, CO2 incubator, washer, qPCR, plate hotel).
- Reagents: IL-6 DuoSet ELISA and ancillaries, CellTiter-Glo 2.0, cell culture media, DMSO and staurosporine, three ATCC cell lines, a few molecular biology kits, each with storage and handling rules.

Found so far: the unit registry has no length (mm), wavelength (nm), speed (rpm) or centrifugal force (x g). Labware geometry and instrument specs need them, so plan 007 adds them.

## Round 6 answers (Wali, 2026-09-29)

| # | Answer |
| --- | --- |
| 1 | Instruments: Opentrons Flex, Echo 650, Hamilton STAR, Hamilton Vantage, Formulatrix Mantis, PreciseDrop II, Tecan Spark Cyto, BlueCatBio BlueWasher, Analytik Jena CyBio FeliX, qTOWER3, Bio-Rad PTC Tempo (2 x 96, 1 x 384), HighRes FlexPod, MicroSpin, LidValet and PlateOrient, Thermo Cytomat 10 |
| 2 | Assays: sandwich ELISA; single-point compound screen with dose-response follow-up (CellTiter-Glo or HiBiT); enzyme functional kinetic screen (absorbance or fluorescence); Promega Dual-Glo reporter assay (gene expression, confirmed 2026-09-29); plasmid assembly (Gibson, Golden Gate) with purification |
| 3 | Fictional demo lab |
| 4 | Asked for a recommendation: YAML in the repo's `seed/`, one file per registry. Vendor PDFs go in the project files (not the repo), linked from the SOP entries |
| 5 | Our own short SOPs, SOPs found online, and vendor protocols |
| 6 | Kinds plus a small stocked lab |

## Round 6: scope questions (as asked)

| # | Question | Options | Default and why |
| --- | --- | --- | --- |
| 1 | Which instruments are in the seed lab | A) The ones you named (STAR, Flex, Echo 650, a plate reader) plus typical support kit (sealer, centrifuge, CO2 incubator, washer) · B) Your real lab's list, with models | **B if you can list them, otherwise A.** Tell me the plate reader model, whether there is an OT-2 as well as the Flex, the STAR's channels and 96 head, and any automated incubator or plate hotel. |
| 2 | Which assays get full templates | A) Sandwich ELISA (IL-6 DuoSet) and a 384-well compound dose-response viability screen (Echo, CellTiter-Glo) · B) Add qPCR · C) Your lab's real assays instead | **A.** They are the two named in plan 000 and together exercise every instrument class. |
| 3 | Real lab or a fictional demo lab for instances | A) A fictional lab ("Demo Lab", made-up serials, rooms and barcodes) · B) Your real lab's rooms, serials and people | **A.** Seed files are committed to the repo; real serials and names stay out. Your real lab can be imported later as data. |
| 4 | Where and in what format the data lives | A) YAML files in the repo's `seed/`, one per registry, with sources and verified/estimated/unknown per value · B) JSON validated against schemas · C) Only in the project files, not the repo | **A.** YAML reads well in review and allows comments; the registry plans validate it against their schemas when they add loaders. |
| 5 | SOP sources and licensing | A) Write our own short SOPs for the two assays and routine tasks (plate coating, cell passaging, compound plate prep), citing vendor manuals · B) Also import public protocols from protocols.io under CC BY with attribution · C) Include vendor kit manuals as PDFs | **A plus B.** Our own SOPs are free to use and digitize; CC BY protocols add variety for the SOP library. Vendor PDFs are usually copyrighted, so link them instead. |
| 6 | Instance and state depth | A) Kinds only now; instances (plates, lots, stocks) come with plan 010 · B) Kinds plus a small stocked lab now: instrument instances with configurations, a freezer and fridge, lots with expiry, a few plates already filled | **B.** A stocked lab is what makes demos and e2e tests realistic, and the data is cheap to write while the research is fresh. |

## Rules for the data

- Every quantity carries a unit; values are decimal strings.
- Every item lists its source URLs, and every field is marked verified, estimated or unknown, with a note for anything not from a primary source.
- No invented catalog numbers. An unknown stays unknown.
- Handling rules that come from a vendor say so; ones that are lab conventions (for example time out of the incubator for live cells) are marked as conventions.
