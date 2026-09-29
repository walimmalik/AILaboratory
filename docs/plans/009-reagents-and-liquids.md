# 009: Reagents and liquids

- Status: accepted by Wali 2026-09-29 (R1 to R12 as recommended, with the notes under each round's answers). Ready to build after 008a, since liquid classes name pipetting devices.
- Depends on: 002 (records), 003 (operations), 004c (draft-and-confirm), 007 (labware types, vendors, tip racks, dead volumes), 008 (instrument and equipment kinds, pipetting devices)
- Feeds: 010 (containers hold lots; handling rules flow into plates), 012 (SOP variables link to product and lot values), 014 (plate maps name reagents), 016 (transfer designer picks a liquid class per transfer), 019 (scheduler reads handling rules)

## What this plan delivers

A library of what the lab pipettes: products and kits with part numbers and catalog data, their lots with certificate values and expiry, lab-made solutions, and **liquid classes**, the per-instrument settings that say how to aspirate and dispense each liquid. Everything is deep-linked: a product to its vendor and to the labware and instruments that handle it, a lot to the containers holding it (010), a liquid class to the instrument kind, pipetting device and tips it was made for.

An agent drafts a product from a catalog number or pasted datasheet, marks what it assumed, and a person confirms it. The same goes for liquid classes and for recording a received lot.

## Starting point

- `seed/reagents.yaml` (plan 006): 28 real products and kits with components, storage, typed-ish handling rules, hazards, a free-text `liquid_behaviour` hint and per-field verified/estimated/unknown status. `seed/inventory.yaml` has 22 demo lots with CoA values. This plan turns their shape into schemas; the loader converts them.
- Vendors (`vnd_`) are created in 007 and shared here.
- `seed/instruments.yaml` records what each dispenser accepts: the Echo 650's fluid types (70 to 100% DMSO, aqueous buffers and media, up to 50% glycerol), Mantis chips (LV, HV) with dead volumes, and STAR and Vantage channel types. The Echo's software calibration names are marked unknown.
- What the platforms do today:
  - **Hamilton STAR and Vantage (Venus):** liquid classes are named parameter sets in the Venus database, specific to channel type, tip type, dispense mode (jet or surface, empty or part) and liquid, with a volume correction curve. Proprietary; we can read and name them but can't validate anything we'd write (same reasoning as L6 in 007).
  - **Opentrons Flex:** the Python API has transfer parameters (flow rates, air gaps, touch tip, blowout, mix) and, in recent API versions, built-in liquid classes such as water, 50% glycerol and 80% ethanol. Open and checkable in their simulator. To be verified against the current docs before 009b.
  - **Echo 650:** a calibration pairs a source plate type with a fluid (DMSO, aqueous variants, glycerol). The name travels with the source plate type in the worklist.
  - **Mantis, PreciseDrop, BlueWasher, FeliX, manual pipetting:** chip or head choice plus a few settings; for a person, a technique (forward or reverse pipetting, pre-wet, slow).

## Proposed model

| Layer | Record | Holds |
| --- | --- | --- |
| Kind | **Product** (`prd_`, `PRD-0001`) | Name, vendor and manufacturer, catalog numbers per pack size and supplier, category, form (liquid, powder, frozen cells…), composition and concentration, storage, handling rules, hazards (GHS codes and SDS link), **liquid type**, datasheet links, which fields are lot-specific, evidence per field |
| Kind | **Kit** (a product with `components`) | Links to its component products with the amount of each per kit (see R2) |
| Kind | **Recipe** (a lab-made product, see R3) | Components as links to products with scalable amounts, target concentrations, shelf life after preparation, link to the preparation SOP |
| Kind | **Liquid type** (`lqt_`, `LQT-0001`) | Platform-neutral behaviour: aqueous, DMSO, glycerol 50%, serum or protein-rich, detergent, ethanol, volatile organic, cell suspension. Properties with units and sources: viscosity, density, volatility, foaming, surface tension class, hygroscopic (see R4) |
| Kind | **Liquid class** (`lqc_`, `LQC-0001`) | For one instrument kind, pipetting device (008 equipment kind), tip or source labware type (007), dispense mode and volume range: the platform's own name and/or parameters, which liquid types it serves, verification status and evidence (see R4, R5) |
| Instance | **Lot** (`lot_`, `LOT-0001`), see R1 | Product, lot number, expiry, received and opened dates, CoA values for the product's lot-specific fields, component lots for a kit, CoA file link |
| State | Containers holding a lot, volumes, locations | Plan 010 |

**How a transfer gets its liquid class** (a resolver in `packages/domain/liquids`, pure and unit tested): given the liquid (product, lot or a container's contents from 010), the instrument configuration, the device, the tip or source plate, the volume and the dispense mode, return the class to use and why. Order: an explicit choice on the SOP step or transfer, then a product-level override for that instrument, then the lab's default class for that liquid type on that device and tip, else "no validated class" as a readiness issue. Lab memory quirks ("STAR channel 3 drips below 5 µL with the water class") show next to the result; they don't silently change it.

**Handling rules** (see R6) are typed: storage temperature range, light sensitivity, freeze-thaw limit, stability after opening, reconstitution or thaw, equilibrate before use, rest after reconstitution, mix-before-use window, max time out of storage, hygroscopic, time to read after a step. Each carries its source (vendor with link, lab convention, lab memory) and whether the scheduler enforces it or it is advice.

## Operations (first cut)

| Operation | Agents |
| --- | --- |
| `reagents.draft_product` from a description, catalog number or pasted datasheet text (kits draft their components too) | direct (drafts) |
| `reagents.update_product`, `reagents.confirm_product` | direct on drafts, proposed on active; confirm is proposed |
| `reagents.draft_recipe`, `reagents.scale_recipe` (amounts for a target volume, read-only) | direct / read |
| `reagents.receive_lot` (lot number, expiry, CoA values; containers are created by 010) | proposed |
| `reagents.set_lot_status` (opened, quarantined, expired, used up) | proposed |
| `liquids.draft_type`, `liquids.draft_class`, `liquids.confirm_class` | direct (drafts), confirm proposed |
| `liquids.record_verification` (gravimetric or dye check: volume, CV, accuracy, evidence) | proposed |
| `liquids.resolve_class` | read |
| `reagents.get`, `reagents.search` (vendor, catalog number, category, liquid type, storage, expiring soon, used in), `liquids.search_classes` | read |

## Screens

- **Reagent library:** a dense list with filters (category, vendor, storage, liquid type, has lots in date), a lot count and next expiry per product.
- **Product page:** specs in plain words, handling rules with their source, hazards, kit components, lots with expiry and CoA values, where it is used (SOPs, plates, recipes), and the liquid class each instrument would use for it, with the reason.
- **Liquid classes:** a matrix of liquid types against the lab's pipetting devices (STAR 1 mL channel, Flex 1-channel 1000 µL, Echo 384PP, Mantis LV chip, a person with a P200…), each cell showing the class, whether it is verified, and gaps in agent ink.
- **Draft pages** for products, recipes and classes with the readiness panel: what is filled, what is missing, what was assumed.

## Round 1 answers

Wali chose A for R1 to R6 on 2026-09-29. On R5 Wali asked to be able to edit classes, so:

- Opentrons, Echo, Mantis, PreciseDrop, washer and manual classes are edited here like any record: a draft of the change, then confirm, which makes a new version.
- Venus classes (STAR, Vantage, FeliX) are edited here too, but the copy then no longer matches what Venus runs. The class shows "changed here, apply in Venus" until a re-import from Venus matches it, and the transfer designer warns while that is true. We never write Venus files (L6).

## Round 1 questions (as asked)

Recommended option in bold.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| R1 | Where do lots live? | A) 009 owns products and lots (lot number, expiry, CoA values, component lots); 010 owns the containers that hold a lot, their volumes and locations · B) 009 is products only; lots come with inventory (010), like physical plates did in 007 | **A.** A lot is the instance of a product and carries data about the batch (CoA concentrations, expiry) that SOPs and plate maps need, even before anyone tracks vials. Barcodes, locations and volumes still belong to 010 alone, so L1's reasoning holds. |
| R2 | How are kits modeled? | A) A kit is a product whose components are their own product records (part number, storage, liquid type, lot-specific fields), linked with the amount per kit; a kit lot lists its component lots · B) Components are an embedded list inside the kit, not records · C) No kits, only single products | **A.** A container in 010 holds "DY206 detection antibody", not "DY206", and needs that component's liquid type, storage and CoA concentration. Components also get reused across kits (Reagent Diluent in several DuoSets). |
| R3 | Do lab-made solutions belong here? (Reagent Diluent, wash buffer, complete medium, 10 mM compound stocks) | A) Yes: a recipe is a product the lab makes, with components linked to products, scalable amounts and a link to the preparation SOP; making a batch creates a lab-made lot · B) Leave them to digital SOPs (012) as step outputs · C) Treat them as free-text container contents | **A.** They are most of what actually gets pipetted, they need liquid types and shelf lives like bought reagents, and a batch should trace back to the lots it was made from. |
| R4 | How are liquid classes modeled? | A) Two layers: platform-neutral liquid types on products (aqueous, DMSO, 50% glycerol, serum, detergent, ethanol, cell suspension…), and per-device liquid classes that serve liquid types; a resolver picks the class and explains why, with product-level overrides · B) Map each product directly to a class per instrument, no liquid types · C) Free-text hints only, as in the seed | **A.** With 28 products and around ten dispensing devices, B means hundreds of hand-made mappings; with A a new product gets a class on every instrument as soon as its liquid type is set, and exceptions stay possible. It is also how Venus, Opentrons and the Echo already think. |
| R5 | What does a liquid class store per platform? | A) Opentrons: full parameters (we generate and simulate these). Hamilton STAR, Vantage and FeliX: the name of the lab's existing class plus an optional read-only copy of its parameters imported from an export, marked "as reported by Venus". Echo: the calibration name per source plate type. Mantis, PreciseDrop, washer: chip or head plus settings. Manual: technique · B) One neutral parameter schema for every platform, translated per platform · C) Names only everywhere | **A.** Same rule as L6: store full parameters only where we can validate what we generate. A neutral schema (B) would claim equivalences between Venus and Opentrons settings that nobody has measured. |
| R6 | Where is the handling-rule vocabulary defined? (plan 000 left it to 010) | A) Here, as a typed list shared by products, recipes and later entity kinds (010 adds live-cell rules); each rule says its source and whether the scheduler enforces it or it is advice · B) Wait for 010 and keep free text until then | **A.** Reagents are the first records that carry rules (TMB light, Dual-Glo mix window, DMSO hygroscopic), and the seed already has them half-typed. Deciding "enforced or advice" now keeps the scheduler from inheriting a pile of text it can't use. |

## Defaults I'm assuming (say if any is wrong)

- Prices and ordering (suppliers, reorder points, purchase requests) are out of scope; catalog numbers per pack size and supplier are in.
- Hazards: GHS codes, signal word and an SDS link per product. SDS files are linked, not stored, until the app has file attachments.
- The agent drafts products as in L5: seed data, pasted or uploaded datasheets, and its own knowledge marked as estimated. No web access for the in-app agent in this plan.
- Unknown stays unknown: values the seed marks unknown are imported as unknown, never filled with a guess.
- Liquid classes start as "vendor default" or "lab's existing" and only become "verified in this lab" with a recorded verification run.

## Round 2 answers

Wali chose A for R7 to R12 on 2026-09-29, with these notes:

- **R8, mixtures.** Wali asked whether "take the largest component" (C) is easier to use. For the person it is the same: nobody sees the rules, only the liquid type on the well, marked assumed. The rule is C with a few exceptions: the largest component decides, unless DMSO, glycerol, ethanol or another listed solvent passes its threshold (for example at least 70% DMSO counts as DMSO, over 20% glycerol as glycerol). Plain C would call 50% glycerol in water aqueous, which is the case where the liquid class matters most.
- **R11, verification without real data.** Until the lab runs real checks, the seed carries demo verification records marked `demo`. They exercise the screens and tests but never make a class "verified in this lab"; only a record from a real run can. Seeded classes stay "vendor default".
- **R12, where the seed classes come from.** Checked 2026-09-29:
  - **Opentrons:** `shared-data/liquid-class/definitions/1/` in the Opentrons repo (Apache-2.0) has `water`, `glycerol_50` and `ethanol_80`, each with settings per Flex pipette model and per tip rack (submerge, aspirate, dispense, air gaps, blowout, touch tip, flow rates by volume). That per-pipette, per-tip shape confirms R7. Imported as full parameters.
  - **Hamilton:** PyLabRobot (MIT, the lab automation forum's project) has Hamilton's default liquid classes as data: 454 for the STAR (`pylabrobot/hamilton/star/liquid_classes/mapping.py`) and 428 for the Vantage (`.../vantage/liquid_classes/mapping.py`). Each is keyed by tip volume, head type, filter, liquid, jet or surface and empty or part, with a volume correction curve, flow rates, air gaps, swap speed, settling times and LLD settings. Imported as the read-only Venus copy (R5), sourced "Hamilton default, via PyLabRobot", and matched to the lab's real Venus names when those are imported.
  - **Echo:** Wali confirmed (2026-09-29) the Echo 650 names its calibrations like `DMSO`, `DMSO2`, `AQ_CP` and `AQ_BP`, and the name the Echo uses is the plate type and calibration joined: `384PP_DMSO2`, `384LDV_DMSO2`. Each Echo class stores that full name as its platform name and links the source labware type (007) it belongs to, so a worklist gets the exact string and the class can only be picked for that plate. The seed uses these names as "vendor default". What each aqueous code covers (BP buffer, CP concentrated protein, plus SP surfactant and GP glycerol if present) is marked estimated until checked against the Echo software; the full list per source plate type comes from Wali's laptop when 009b starts. One Echo class = source plate type + calibration name, which fits R7.

## Round 2 questions (as asked)

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| R7 | How specific is one liquid class? | A) One class is for one device (STAR 1 mL channel, Flex 1-channel 1000 µL…), one tip or source plate type, one dispense mode (jet or surface, empty or part) and one volume range; a liquid type usually has several classes on a device · B) One class per device and liquid type, whatever the tip or volume | **A.** That is how Venus and the Echo already split them, and accuracy really does change with tip and volume. The resolver hides the detail: people pick a liquid, not a class. |
| R8 | What liquid type does a mixture have (a well with 1% BSA in PBS plus sample, 0.5% DMSO in medium)? | A) Computed from its contents with simple rules (for example at least 70% DMSO counts as DMSO, over 20% glycerol as glycerol, otherwise aqueous with protein or detergent flags), shown as assumed until a person or an SOP step sets it · B) Always set by hand or by the SOP step that made it · C) Take the largest component | **A.** Plate maps and transfers create thousands of mixtures, so hand-setting (B) won't happen, and C gets 50% glycerol wrong. The thresholds live in `packages/domain` with tests and are easy to tune. |
| R9 | How do lot-specific values reach SOPs? (DuoSet capture antibody working concentration is "per CoA") | A) A product declares its lot-specific fields; an SOP variable links to the field, and the value comes from the lot picked when the experiment is planned; before a lot is picked, a typical value shows as estimated · B) A person types the value into the experiment | **A.** It is the deep linking the whole system is built on, and it catches the classic mistake of using last lot's dilution. |
| R10 | What happens with expired or quarantined lots? | A) Quarantined lots can't be used in new plans. Expired lots show as a readiness warning, and confirming a design that uses one needs a reason, which goes in the history · B) Warnings only for both · C) Block both | **A.** An academic lab does use reagents past expiry on purpose; recording why keeps that honest without getting in the way. Quarantine is an explicit "don't", so it blocks. |
| R11 | How is a liquid class proven? | A) A verification record: method (gravimetric, dye, photometric), target volume, replicates, mean, CV, accuracy, instrument, tips, date and a link to the raw data; a class is "verified in this lab" only with one that passes · B) A status flag and a note | **A.** Rule 10 says never claim unvalidated accuracy. The analysis module (020) can later compute these from raw plate reads. |
| R12 | Where do the first class names come from? | A) Seed Hamilton's standard default classes, Opentrons' built-in classes and the Echo's standard calibrations, marked "vendor default", then import your real Venus and Echo lists from your laptop when 009b starts · B) Wait and import only your real lists · C) Only vendor defaults | **A.** Tests and demos get working classes now, and your real lab data replaces the defaults before anything depends on them. |

## Proposed split

- **009a:** schemas (product, kit, recipe, lot, liquid type, handling rules), operations, seed loader for `reagents.yaml` and the lots in `inventory.yaml`.
- **009b:** liquid types and liquid classes, the resolver in `packages/domain/liquids`, seed classes for the lab's instruments.
- **009c:** reagent library, product and lot pages, liquid class matrix, agent drafting with the readiness panel.
