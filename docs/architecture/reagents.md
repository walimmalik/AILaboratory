# Reagents and liquids

Plan 009. What the lab pipettes: products it buys or makes, their lots, how each liquid behaves, and the rules for handling them. ADR 0027.

## Kinds

| Kind | IDs | Holds |
| --- | --- | --- |
| `product` | `prd_`, `PRD-0001` | Category, bought or made, vendor and catalog numbers, form, composition, concentration, molar mass, CAS number, liquid type, storage temperature, shelf life, handling rules, hazards (GHS codes, signal word, SDS), lot fields, kit components, recipe, datasheets |
| `lot` | `lot_`, `LOT-0001` | Product, lot number, status, expiry, received or made, opened, certificate values, component lots, certificate link |
| `liquid_type` | `lqt_`, `LQT-0001` | Base family and properties with units: viscosity, density, volatility, foaming, surface tension, hygroscopic |

Schemas are in `packages/schema/src/reagents.ts`, kinds and checks in `apps/api/src/reagents/kinds.ts`.

- A **kit** is a product with `components`, each its own product (the capture antibody, the standard), with an amount or count per kit.
- A **lab-made** product (`origin: "made"`) has a `recipe`: what a batch yields and each component's product and amount. `reagents.scale_recipe` scales it to a target batch with the calculators in `packages/domain/src/reagents.ts`.
- **Lot fields** name the values each lot's certificate gives (a working concentration, a dilution). A lot's `values` give them; the product's `typical` value stands in, as estimated, until a lot is picked.

## Handling rules

A closed list; each rule has plain words (`text`), a `source` (`vendor` with a reference, `lab_convention` or `lab_memory`) and `enforced` (true: the scheduler keeps to it; false: advice). Rules: `protect_from_light`, `keep_cold`, `freeze_thaw_limit` (`cycles`), `stable_after_opening` (`period`), `stable_after_preparation` (`period`, `at`), `reconstitute` (`period` to rest), `thaw`, `equilibrate`, `mix_before_use`, `use_within` (`period`), `max_time_out_of_storage` (`period`), `hygroscopic`, `read_within` (`after`, `min`, `max`) and `advice`, which is never enforced. Periods run from seconds to days.

## Operations

| Operation | Does | Agents |
| --- | --- | --- |
| `reagents.draft_product` | Drafts a product; a kit's new components are drafted with it and linked | direct (drafts) |
| `reagents.scale_recipe` | Amounts of each component for a target batch | read |
| `reagents.receive_lot` | Records a lot (active); checks certificate values against the product's lot fields and units, component lots against the kit or recipe, and the lot number against the product's other lots | proposed |
| `reagents.set_lot_status` | Opened (with the date), quarantined, expired, used up, unopened | proposed |
| `reagents.search` | Products by text (name, readable name, catalog number, CAS), category, vendor, liquid type, storage band, origin, a lot in date or expiring within some days; each with its lot count, lots in date and next expiry (`lotSummary` and `storageBand` in `packages/domain`) | read |

Editing and confirming products use `records.update` and review. Storage bands come from the upper end of the storage range: room above 10 °C, fridge to 10 °C, freezer to −10 °C, deep freezer to −60 °C, cryo to −130 °C. A lot is in date when it is unopened or opened and not past its expiry. "Used in" (SOPs, plates) waits for those records (011, 010).

## Seed

`seed/reagent-library.yaml` holds the lab's products in the library's shape, made from the research in `seed/reagents.yaml`: 28 products, the reagent components of their kits (consumables such as plates, sealers and columns are left to labware and inventory), two lab-made buffers from the DuoSet datasheet (Reagent Diluent, Wash Buffer) with recipes, and the eight liquid types. A product's first datasheet is the evidence for every attribute except those it lists under `assumed` (liquid types picked from pipetting hints, estimated hazards, guessed forms), which load as assumed. The research's handling rules are mapped onto the typed list; what doesn't fit a typed rule is `advice`. Shelf lives in months stay in the notes, since periods run to days.

The demo lab's lots (from `seed/inventory.yaml`) go through `reagents.receive_lot`. The seed runs as an agent, so they wait on the Review page as proposals; a second run skips lots already recorded or waiting.

## Liquid classes (009b, ADR 0028)

| Kind | IDs | Holds |
| --- | --- | --- |
| `liquid_class` | `lqc_`, `LQC-0001` | Instrument model, device, tips or source plate, dispense mode, volume range, liquid types served, lab default, platform name, origin, per-platform settings |
| `liquid_class_verification` | `lqv_`, `LQV-0001` | Class, instrument, method, date, target, replicates, mean, CV, limits, raw data link, demo |

Schemas are in `packages/schema/src/liquids.ts`; the calculators (`resolveClass`, `mixtureLiquidType`, `verificationResult`) are in `packages/domain/src/liquids.ts`.

Settings per platform: `opentrons` (the full transfer properties for one pipette model and tip rack, as in Opentrons' liquid class schema 1), `hamilton` (the Venus class with an optional read-only parameter copy and `changedHere`), `echo` (calibration code; the platform name is the full `384PP_DMSO2`), `dispenser`, `manual` (technique).

A product can name `liquidClasses` to use instead of the lab default for its liquid type on each class's device.

| Operation | Does | Agents |
| --- | --- | --- |
| `liquids.resolve_class` | Picks the class for a transfer: explicit, then the product's own, then the lab default for its liquid type (verified first); only confirmed classes; says why or what is missing | read |
| `liquids.mixture_type` | A mixture's liquid type from its parts (largest part, unless DMSO ≥ 70%, glycerol > 20%, ethanol or volatile ≥ 50%) | read |
| `liquids.record_verification` | Records a check and its result; passing real runs make a class verified in this lab | proposed |
| `liquids.search_classes` | Classes by text (name or vendor name), instrument model, device, tip, liquid type, platform, verified; each with whether it is verified and its latest check | read |

### Seed classes

`seed/liquid-classes.yaml` names what to load; items refer to keys in the instrument library, labware and reagent library. Opentrons classes come from Opentrons' own files (`seed/liquid-classes/opentrons/`, unchanged, Apache-2.0): one class per liquid, per Flex pipette and per filter tip rack the lab has. Hamilton's defaults (`seed/liquid-classes/hamilton-defaults.yaml`) were generated once from PyLabRobot's mappings (MIT) for the lab's CO-RE II 50, 300 and 1000 µL filter tips on the STAR and VANTAGE channels and 96 heads, for water, DMSO, serum, ethanol and 80% glycerol. Their volume range runs over the calibrated points. The four Echo classes are the names Wali confirmed. Every class loads as a vendor default and lab default for its liquid type. The mapping from a vendor class to our liquid types is marked assumed. A class whose instrument, device, tips or liquid type the lab lacks is skipped and counted.

When several default classes fit and differ in dispense mode (Hamilton's jet or surface, empty or part), the resolver asks for the mode rather than picking one.

## Screens (009c)

The menu has a Reagents group: **Reagents** (every product with its type, vendor, storage band, lots in date and next expiry; filters for storage and "has a lot in date"), **Lots**, **Liquid classes** and **Liquid types**. Liquid classes opens with a matrix: one row per instrument model and device (or source plate type, for the Echo), one column per liquid type, each cell counting the classes that serve it and how many are verified. Drafts and a missing default are in agent ink; a cell with no class at all is a dash. Pointing at a cell lists its classes. A product's page lists its lots, soonest expiry first; a liquid class's page lists its checks, with demo runs marked as not counting.

Not yet: the class each instrument would use for a product (needs a volume and a device, so it waits for transfers, 016), and where a product is used (SOPs and plates, 010 and 011).

