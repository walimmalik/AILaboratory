---
name: ailab-liquids
description: Find the liquid class for a transfer in AILaboratory, work out a mixture's liquid type, draft liquid classes and record verification runs through its MCP tools.
---

# Liquid classes in AILaboratory

A **liquid type** (`liquid_type`, `LQT-0001`) says how a liquid behaves: aqueous, DMSO, glycerol, protein-rich, detergent, ethanol, volatile organic or cell suspension. A **liquid class** (`liquid_class`, `LQC-0001`) says how one device pipettes it: one instrument model, one pipette, head or chip, optionally particular tips or one Echo source plate, a dispense mode and a volume range. Read `records.kinds` for the full schemas.

## Which class to use

Never pick a class yourself. Call `liquids.resolve_class` with `{liquid: {product} or {liquidType}, instrumentKind, device?, tip?, sourceLabware?, mode?, volume, liquidClass?}`. It returns the class, how it was chosen (`explicit`, `product_override`, `lab_memory` when a confirmed lab memory prefers it for this work, `lab_default` or `none`), `why` in plain words, `verified`, the lab memories that shaped it (`memory`), and alternatives. A default lab memory that avoids a class puts it last among the lab defaults; a rule that avoids it refuses it. Quote `why` to the person. When it returns `none`, tell the person the `issue`; don't substitute a class.

To see what the lab has (a class for a device, which liquid types have none, which are verified), call `liquids.search_classes` with `{text?, instrumentKind?, device?, tip?, liquidType?, platform?, verified?, status?}`. It lists classes with `verified` and the `lastCheck`. It is for looking around; the choice for a transfer still comes from `liquids.resolve_class`.

For a mixture (a well with sample, buffer and DMSO), call `liquids.mixture_type` with the parts and volumes first. The type it returns is an assumption; say so.

## Drafting a class

Use `records.create` with kind `liquid_class`: `instrumentKind`, `device`, `tips` or `sourceLabware`, `mode` (`jet_empty`, `jet_part`, `surface_empty`, `surface_part`), `volume: {min, max}`, `liquidTypes`, `labDefault`, `origin` (`vendor_default`, `lab_existing`, `lab_made`), `platformName`, and `settings`:

- Opentrons: `{"platform": "opentrons", "pipetteModel": "flex_1channel_1000", "tiprack": "opentrons/opentrons_flex_96_tiprack_200ul/1", "properties": {…}}`, where the properties follow Opentrons' liquid class schema.
- Hamilton: `{"platform": "hamilton", "system": "star", "tipVolume": …, "core": false, "needle": false, "filter": false, "reportedBy": "venus", "changedHere": false}`. Never invent Venus parameters. A copy comes only from an export.
- Echo: `{"platform": "echo", "calibration": "DMSO2"}`, with `platformName` `384PP_DMSO2` and the source plate type.
- Manual: `{"platform": "manual", "technique": "reverse", "preWet": true, "speed": "slow"}`.

A person confirms What it is for and Platform settings. Only confirmed classes are used.

## Verification

`liquids.record_verification` with `{liquidClass, method (gravimetric, dye, photometric), date, target, replicates, mean, cv, limits: {accuracy, cv}, instrument?, rawData?, demo}` records a check and returns whether it passed. It is a proposal from you. Mark test and made-up runs `demo: true`; they never make a class verified.
