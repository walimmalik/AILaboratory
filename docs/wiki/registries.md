# Registries

The four registries hold what the lab has: labware, instruments, reagents and physical stock. All four are locked and not yet built; 007 is next. Each lands as a thin vertical slice: schema, operations, skill, seed loader, screens, and agent drafting with the readiness panel.

## Labware (plan 007)

[Plan 007](../plans/007-labware-library.md), [ADR 0023](../decisions/0023-labware-types.md), [labware.md](../architecture/labware.md). **Labware types only**: the Corning 3570, not the barcoded plate (that is a container in 010).

**Built (007a, PR #13):** kinds `labware_type` and `vendor`; sections Identity, Geometry, Volumes and Instrument names; blocker and warning checks that each name their source (ANSI/SLAS 1-2004 and 4-2004 for SBS); `labware.wells`, `labware.import_opentrons` and `labware.export_opentrons` (in the `custom_beta` namespace); the seed loader. Drafting, editing and confirming use `records.*`. Liquid height is computed for flat-bottomed wells only; round and V bottoms are refused until their profiles are modelled. **007b in progress:** Library pages, editing in place and to-scale drawings are merged. **Still to come:** per-instrument dead volumes (they link to instrument kinds from 008), and merging echo650-twin's catalog through the same importer.

- One kind with a family: plate, reservoir, tube, rack, tip rack, lid (flask and dish added for cell culture).
- Identity: plain name, manufacturer (a shared vendor record), catalog numbers per pack size and supplier, material, colour, treatment, sterile.
- Geometry in mm: footprint and height, SBS class, wells, stacking offset, grip height. Wells come from a parametric grid, or an explicit list for irregular labware. Names are canonical `A1` (not `A01`) up to `AF48`.
- Volumes: nominal, max working, and dead volume as a default plus per-instrument-kind values (an Echo 384PP well and a hand-pipetted well differ), each with a source. A volume-to-height model per well shape.
- Platform names: Opentrons load name, Hamilton labware file name, Echo plate type. Opentrons JSON can be imported and exported; Hamilton files are never generated.
- Seed: the 33 types in `seed/labware.yaml`, loaded as drafts by `pnpm --filter @ailab/api seed`; Opentrons definitions import one at a time. echo650-twin's reviewed catalog (about 40 definitions with field provenance) can be merged later through the same importer.
- Split: 007a model, geometry and import; 007b library and type pages with the draft view.

## Instruments (plan 008)

[Plan 008](../plans/008-instrument-library.md). Kinds are records (data), so an agent can add a new reader from a datasheet; twins and drivers attach by ID.

**Built (008a, ADR 0025):** kinds `instrument_kind` and `equipment_kind` with sections Identity, Mounts and sites, Capabilities; the capability catalog in code (`instruments.capabilities`); `instruments.resolve`, which checks a configuration (unknown slot, overlap, equipment the mount doesn't take, off the rail) and returns its sites, claims and capabilities. See [instruments.md](../architecture/instruments.md). The seed loads the lab's 16 instrument models, two manual stations (bench, biosafety cabinet) and their equipment (Flex pipettes, gripper, modules and fixtures; STAR and VANTAGE channels, heads, grippers and carriers; FeliX heads and gripper) as drafts. **Built (008b, ADR 0026):** registered instruments (`INS-0001`) and serial-bearing equipment items (`EQP-0001`); `instruments.register`, `instruments.change_configuration` (place, move, remove, set item; checked as a whole), `instruments.set_status`, `instruments.log_service`. The seed registers the demo lab's 18 instruments with their configurations. **Built (008c):** Instruments, Instrument models and Equipment pages in the library; an instrument's page draws its deck per mount and lists what it can do. **Still to come:** 008d workcells.

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

**Built (009a, ADR 0027):** kinds `product` (bought, kit or lab-made, with sections Identity, Contents, Storage and handling), `lot` and `liquid_type`; the typed handling rules; `reagents.draft_product` (a kit drafts its new components), `reagents.scale_recipe`, `reagents.receive_lot` (checks certificate values against the product's lot fields), `reagents.set_lot_status`. See [reagents.md](../architecture/reagents.md). The seed (`seed/reagent-library.yaml`) drafts 28 products, their kit components and two lab-made buffers with the eight liquid types, and proposes the demo lab's 22 lots. **Built (009b, ADR 0028):** kinds `liquid_class` (settings per platform: Opentrons transfer properties, Hamilton's Venus class with a read-only copy, Echo calibration, dispenser, manual technique) and `liquid_class_verification`; `liquids.resolve_class`, `liquids.mixture_type`, `liquids.record_verification`. See [reagents.md](../architecture/reagents.md). The seed drafts the vendor default classes for what the lab has: Opentrons' water, 50% glycerol and 80% ethanol for each Flex pipette and filter tip rack, Hamilton's defaults for the STAR and VANTAGE with CO-RE II filter tips, and four Echo calibrations. **Search (009c):** `reagents.search` (text, category, vendor, liquid type, storage band, lots in date or expiring soon, with each product's lot count and next expiry) and `liquids.search_classes` (with verified and the latest check). **Still to come:** 009c screens.

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
