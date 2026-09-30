# 0027: Products, lots, liquid types and handling rules

- Status: accepted
- Date: 2026-09-30
- Plan: 009 (rounds 1 and 2, R1 to R4, R6, R9, R10; step 009a)

## Context

Plan 009 was accepted with every recommended option. 009a adds what the lab pipettes: products and kits, lab-made solutions, lots with certificate values, liquid types and the typed handling rules. Liquid classes and their resolver follow in 009b, screens in 009c.

## Decision

- **One `product` kind** (`prd_`, `PRD-0001`) covers bought reagents, kits and lab-made solutions. `origin` is `bought` or `made`. A kit lists `components`, each a product record with its amount or count (R2). A lab-made product has a `recipe`: what a batch yields and the product and amount of each component, plus how long a batch keeps (R3). Sections: Identity, Contents, Storage and handling. A lab-made product without a recipe, or a bought one with one, is a blocker.
- **Lot fields** (R9): a product declares the values that change per lot (`key`, label, unit, a typical value). A lot gives them from its certificate as quantities or ratios (`"1:200"`); unknown keys and values in a unit of another dimension are refused.
- **Lots** (`lot_`, `LOT-0001`, R1): product, lot number, status, expiry, received or made, opened, certificate values and link, component lots (a kit's, or what a batch was made from; each must be a lot of one of the kit's or recipe's components). A lot is created active: agents' lots and status changes are proposals (`reagents.receive_lot`, `reagents.set_lot_status`), so the proposal is the review. One lot number per product. Statuses: unopened, opened, quarantined, expired, used up (R10's blocking and reasons belong to the designers that use lots).
- **Liquid types** (`lqt_`, `LQT-0001`, R4): a base family (aqueous, DMSO, glycerol, protein-rich, detergent, ethanol, volatile organic, cell suspension) and properties with units. Units `g/mL` and `mPa.s` join the registry for density and viscosity.
- **Handling rules** (R6) are a closed list, each with plain words, its source (vendor with a link, lab convention, lab memory) and `enforced` (the scheduler keeps to it) or advice: protect from light, keep cold, freeze-thaw limit, stable after opening, stable after preparation, reconstitute, thaw, equilibrate, mix before use, use within, maximum time out of storage, hygroscopic, read within, and `advice` for anything else, which is never enforced.
- **Operations.** `reagents.draft_product` drafts a product, and a kit's new components with it, directly for agents. Editing and confirming go through `records.update` and review, as for every kind with sections; there is no separate update or confirm operation, and one drafting operation serves bought and lab-made products. `reagents.scale_recipe` is the calculator for batch amounts (ADR 0024).
- **Deferred:** `reagents.search` and the lot count and next expiry per product come with the library screens (009c); the recipe's link to its preparation SOP waits for SOP records (011).

## Consequences

- Products link to their vendor, supplier, liquid type, components and recipe components, so "where is this used" works from the links table.
- Handling rules on products are ready for inventory (010) to carry into containers and for the scheduler (019) to read, with each rule's source.
