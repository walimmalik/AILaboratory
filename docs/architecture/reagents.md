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

Editing and confirming products use `records.update` and review. Liquid classes and the class resolver arrive in 009b, the library screens and search in 009c.

## Seed

`seed/reagent-library.yaml` holds the lab's products in the library's shape, made from the research in `seed/reagents.yaml`: 28 products, the reagent components of their kits (consumables such as plates, sealers and columns are left to labware and inventory), two lab-made buffers from the DuoSet datasheet (Reagent Diluent, Wash Buffer) with recipes, and the eight liquid types. A product's first datasheet is the evidence for every attribute except those it lists under `assumed` (liquid types picked from pipetting hints, estimated hazards, guessed forms), which load as assumed. The research's handling rules are mapped onto the typed list; what doesn't fit a typed rule is `advice`. Shelf lives in months stay in the notes, since periods run to days.

The demo lab's lots (from `seed/inventory.yaml`) go through `reagents.receive_lot`. The seed runs as an agent, so they wait on the Review page as proposals; a second run skips lots already recorded or waiting.
