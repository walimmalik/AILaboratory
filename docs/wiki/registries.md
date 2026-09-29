# Registries

The four registries hold what the lab has: labware, instruments, reagents and physical stock. All four are locked and not yet built; 007 is next. Each lands as a thin vertical slice: schema, operations, skill, seed loader, screens, and agent drafting with the readiness panel.

## Labware (plan 007)

[Plan 007](../plans/007-labware-library.md). **Labware types only**: the Corning 3570, not the barcoded plate (that is a container in 010).

- One kind with a family: plate, reservoir, tube, rack, tip rack, lid (flask and dish added for cell culture).
- Identity: plain name, manufacturer (a shared vendor record), catalog numbers per pack size and supplier, material, colour, treatment, sterile.
- Geometry in mm: footprint and height, SBS class, wells, stacking offset, grip height. Wells come from a parametric grid, or an explicit list for irregular labware. Names are canonical `A1` (not `A01`) up to `AF48`.
- Volumes: nominal, max working, and dead volume as a default plus per-instrument-kind values (an Echo 384PP well and a hand-pipetted well differ), each with a source. A volume-to-height model per well shape.
- Platform names: Opentrons load name, Hamilton labware file name, Echo plate type. Opentrons JSON can be imported and exported; Hamilton files are never generated.
- Seed: Opentrons shared-data and echo650-twin's reviewed catalog (about 40 definitions with field provenance), plus 33 types in `seed/labware.yaml`.
- Split: 007a model, geometry and import; 007b library and type pages with the draft view.

## Instruments (plan 008)

[Plan 008](../plans/008-instrument-library.md). Kinds are records (data), so an agent can add a new reader from a datasheet; twins and drivers attach by ID.

- **Instrument kind** and **equipment kind** (pipettes, grippers, modules, carriers, heads, adapters).
- **Registered instrument** with serial, room, owner, status, service and calibration dates, and its **current configuration**: an equipment graph where parts attach to named mounts (slots, rails, surfaces). Each mount says who can change it and roughly how long it takes.
- Resolving a configuration gives the sites where labware can sit, the claims, the capabilities with their limits, and validation issues. Capabilities come from the resolved instrument, not the model name.
- **Capability contracts** (transfer, dispense, move labware, seal, peel, read absorbance, fluorescence or luminescence, incubate, shake, centrifuge, heat or cool, wash, image, store, delid, rotate, qPCR…) are code; limits are data.
- **Manual stations** (bench, biosafety cabinet, hand multichannel, manual sealer) are instrument kinds a person operates, so manual ELISA steps can be scheduled.
- **Workcells** (008d) are design documents built from registered instruments and FlexPods. An instrument is in at most one physically active workcell; others are used standalone.
- Storage-only units (a manual freezer) are inventory locations; automated stores (Cytomat) are instruments with storage sites.

**The lab's instruments** (the seed models these first): Opentrons Flex; Echo 650; Hamilton STAR (8 channels, 96 head, CO-RE gripper) and Vantage (8 channels, 96 head, track and CO-RE grippers); Formulatrix Mantis; Dispendix PreciseDrop II; Tecan Spark Cyto; BlueCatBio washer; Analytik Jena CyBio FeliX (250 and 1000 µL heads); qTOWER3 auto 96; Bio-Rad PTC Tempo (2 x 96, 1 x 384); HighRes FlexPod, MicroSpin, LidValet and PlateOrient; Thermo Cytomat 10 C.

## Reagents and liquid classes (plan 009)

[Plan 009](../plans/009-reagents-and-liquids.md).

- **Product**: vendor, catalog numbers, category, form, composition, storage, handling rules, hazards (GHS, SDS link), liquid type, which fields are lot-specific.
- **Kit**: a product whose components are their own products (a container holds "DY206 detection antibody", not "DY206").
- **Recipe**: a lab-made solution with scalable amounts and a link to its preparation SOP; a batch is a lab-made lot traceable to its ingredients.
- **Lot**: lot number, expiry, opened date, CoA values, component lots. Quarantined lots are blocked; expired lots warn and need a reason.
- **Liquid type**: platform-neutral behaviour (aqueous, DMSO, glycerol 50%, serum, detergent, ethanol, cell suspension) with properties and sources. A mixture's type is computed from its contents and marked assumed.
- **Liquid class**: for one device, one tip or source plate type, one dispense mode and one volume range. Opentrons classes hold full parameters; Venus classes hold the lab's class name plus a read-only imported copy; Echo classes are the plate type and calibration joined (`384PP_DMSO2`, `384LDV_DMSO2`, `384PP_AQ_BP`). All are editable; an edited Venus class shows "changed here, apply in Venus" until a re-import matches.
- **Resolver**: explicit choice on the step, then a product override, then the lab default for that liquid type on that device and tip, else "no validated class" as a readiness issue. It always says why.
- **Verification**: a class is "verified in this lab" only with a passing gravimetric, dye or photometric check from a real run.
- Seed classes: Opentrons shared-data (Apache-2.0), PyLabRobot's Hamilton defaults (454 STAR, 428 Vantage; MIT). Wali's real Venus and Echo lists come from the laptop when 009b starts.
- Out of scope: prices, ordering, reorder points.

## Inventory (plan 010)

[Plan 010](../plans/010-inventory.md). The lab's physical stock, like Benchling's registry or FreezerPro.

- **Entity kinds** are records on a base class from code (DNA, RNA, protein, chemical, cells, organism, other) with typed fields. Plasmid, fragment, oligo, RNA, protein, antibody, enzyme, compound, cell line and bacterial strain ship as seed kinds; agents draft new ones.
- **Entities** (`PLS-0012`, `CMP-0003`, `CEL-0001`): sequences with features (GenBank, FASTA), SMILES, InChIKey, molecular weight, duplicate warnings. One entity per library compound.
- **Samples**: preps the lab made (a miniprep, a purified protein, a cell bank) with their QC. Bought things and recipe batches are lots (009).
- **Containers**: barcoded plates, tubes, flasks, reservoirs, racks and boxes. The readable name is the barcode (Code 128 on plates, DataMatrix on tubes); vendor codes also resolve. Never deleted once active.
- **Locations**: a fixed tree (room, fridge, freezer, shelf, rack slot). Boxes and racks are containers, so moving a box moves everything in it.
- **Well contents**: full composition (samples and lots, with amount and concentration), liquid type, effective handling rules, lineage.
- **Volume ledger**: fill, transfer, stamp, consume, discard, move, correct. Exact decimals; no negative volumes; below dead volume warns; "unknown" allowed; a measured value replaces a computed one with a reason.
- **Soft reservations**: confirmed plans reserve what they need; pickers show available = current minus reserved.
- **Cell culture**: passage, confluence, viability and count on flasks; banks are samples; mycoplasma results are QC.
- **Imports**: an agent drafts an import from any spreadsheet; a person confirms.
- Split: 010a entities, 010b locations, containers and barcodes, 010c contents and ledger, 010d handling-rule inheritance, 010e screens.
