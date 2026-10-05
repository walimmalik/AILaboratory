---
name: ailab-reagents
description: Draft reagent products, kits and lab-made solutions in AILaboratory, scale recipes, and record lots with their certificate values through its MCP tools.
---

# Reagents in AILaboratory

A **product** (`product`, `PRD-0001`) is something the lab pipettes: a bought reagent, a kit, or a solution the lab makes. A **lot** (`lot`, `LOT-0001`) is one batch of it. A **liquid type** (`liquid_type`, `LQT-0001`) says how a liquid behaves when pipetted. Read `records.kinds` for the full schemas.

## Finding products

Before drafting, check the lab doesn't have it: `reagents.search` with `{text?, category?, vendor?, liquidType?, storage?, origin?, inDate?, expiringWithinDays?, status?}`. `text` matches the name, `PRD-0001`, a catalog number or the CAS number; `storage` is `room`, `fridge`, `freezer`, `deep_freezer` or `cryo`. Each result has `lots: {count, inDate, nextExpiry}`, so "what expires this month" is `{expiringWithinDays: 30}`.

## Drafting a product

Use `reagents.draft_product` with `{label, attributes, components?, evidence?}`.

- `attributes.category` (antibody, assay_kit, buffer, enzyme, substrate, stop_solution, compound…) and `origin`: `bought` or `made`.
- Bought: `vendor` (a `vnd_` record; create it with `records.create` if the lab doesn't have it) and `catalog: [{"number": "DY206", "packSize": "15 plates"}]`.
- A kit: pass `components`. Each is an existing product `{"product": "prd_…", "count": 1}` or a new one `{"draft": {"label": "IL-6 Capture Antibody", "attributes": {…}}, "count": 1}`, which is drafted with the kit.
- Made in the lab: `recipe: {"yields": {"value": "500", "unit": "mL"}, "components": [{"product": "prd_…", "amount": {"value": "5", "unit": "g"}}], "shelfLife": {"value": "7", "unit": "d"}}`. The components must already be products.
- Values that change per lot (a working concentration "per certificate of analysis"): `lotFields: [{"key": "workingConcentration", "label": "Working concentration", "unit": "ug/mL"}]`. Never put a lot's number on the product.
- `storage: {"min": {"value": "2", "unit": "degC"}, "max": {"value": "8", "unit": "degC"}}`, `shelfLife`, `hazards: {"ghs": ["H314"], "signalWord": "danger", "sds": "https://…"}`.

## Handling rules

`handlingRules` is a list of typed rules, each with `text` (the source's words), `source: {"from": "vendor", "reference": "https://…"}` and `enforced` (true only for rules the scheduler must keep to, such as light protection, freeze-thaw limits, time windows). Rules: `protect_from_light`, `keep_cold`, `freeze_thaw_limit` (`cycles`), `stable_after_opening` (`period`), `stable_after_preparation` (`period`), `reconstitute` (`period` to rest), `thaw`, `equilibrate`, `mix_before_use`, `use_within` (`period`), `max_time_out_of_storage` (`period`), `hygroscopic`, `read_within` (`after`, `min`, `max`). Anything else is `advice`. A period is `{"value": "15", "unit": "min"}` in `s`, `min`, `h` or `d`.

## Evidence and review

Say where each value came from in `evidence` (a datasheet URL). Leave out what the source doesn't say; readiness lists it, and a guess would be treated as fact later. A person confirms Identity, Contents, and Storage and handling. Edit drafts with `records.update`.

## Recipes

`reagents.scale_recipe` with `{product, target: {"value": "250", "unit": "mL"}}` returns each component's amount. Use it rather than your own arithmetic.

## Lots

- `reagents.receive_lot` with `{product, lotNumber, expiry?, received?, made?, values?, componentLots?, certificate?}`. `values` are `[{"field": "workingConcentration", "value": {"value": "2", "unit": "ug/mL"}}]` or `{"ratio": "1:200"}`, for the product's lot fields only. A kit lot lists its component lots; a lab-made batch lists the lots it was made from.
- `reagents.set_lot_status`: `opened` (with `date`), `quarantined`, `expired`, `used_up`, `unopened`.
- Both are proposals from you; the person approves them.
- Generic lot creation, attribute updates and restores use the same checks. Supply only declared certificate fields; a field with a declared unit requires a quantity with that dimension (a dilution ratio cannot replace it). Optional missing certificate values may remain absent. Component lots must be in this lab and belong to the kit or recipe; product/lot-number pairs must differ from other non-archived lots. Approval rechecks against current records. The duplicate check does not reserve a lot number against concurrent creates.
