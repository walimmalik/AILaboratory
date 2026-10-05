---
name: ailab-inventory
description: Find where plates, tubes and boxes are in AILaboratory, resolve barcodes, register new containers and move them between freezers, shelves and box positions, through its MCP tools.
---

# Inventory in AILaboratory

A **location** (`location`, `LOC-0001`) is a place that doesn't move: a room, fridge, freezer, shelf, incubator or automated store, inside a parent location. A **container** (`container`, `lw_…`) is one physical plate, tube, reservoir, rack or freezer box, tip rack or lid, of a labware type. Its readable name is its lab barcode: `PLT-000001` for plates, `TUB-` tubes, `RES-` reservoirs, `BOX-` racks and boxes, `TIP-` tip racks, `LID-` lids. What a container holds (samples, lots, volumes) is its well contents, below.

## Finding

- `inventory.scan` with `{code}` resolves anything a person reads or scans: a readable name in any case, with or without the dash (`plt000001`), or a code printed by the manufacturer or vendor (a FluidX tube). It returns the record and its place path, e.g. Cold room › Freezer -80 1 › BOX-000002 › TUB-000001 at A1.
- `inventory.list_place` with `{place, deep?}` lists what is directly in a location or a box; `deep: true` lists everything under it, with each container's position and path.
- `records.list` with `kind: "location"` gives the whole tree.

## Registering and moving

Inventory records describe actual physical things. During SOP/assay intake, use reusable type/product/entity drafts for missing definitions; never invent physical containers, specimens, lots, barcodes, locations, measured concentrations or stock to make feasibility pass. Register/fill only from explicit facts about actual material. A hypothetical sample count is a planning assumption, not an inventory record. Inspect `inventory.overview` and `inventory.where_is` before asking; missing stock stays a preparation blocker, and unknown is not assent. Use calculator operations for every scientific quantity.

All of these are proposals from an agent: a person approves them.

- `locations.create` with `{label, type, parent?, setpoint?, co2?, instrument?, notes?}`. Setpoints carry units: `{"value": "-80", "unit": "degC"}`.
- `inventory.register_containers` with `{labwareType, containers: [{place?, barcodes?, sealed?, lidded?, description?, notes?, label?}], reason?}`: up to 96 of one labware type, all or none. `place` is `{location}` or `{container, position}` for a position in a box (`"B3"`). Put printed codes in `barcodes: [{code, from: "manufacturer" | "vendor" | "earlier_system"}]`; don't invent lab barcodes, the name is one.
- `inventory.move` with `{container, expectedVersion, to, reason?}`. Moving a box moves what is in it.

Refused, with the reason: a position the box doesn't have, a position already holding something, a holder that isn't a rack or box, a box inside itself, an external code already on another container, a location loop, a labware type or location from another lab. Look first (`inventory.list_place` on the box) before picking a position.

## Contents

What a well holds is a `WellState` (see `skills/calculators`). To know what a transfer leaves behind, call `inventory.calculate_transfer`; don't work concentrations out yourself.

- `inventory.wells` with `{container}` lists what each well holds; `inventory.history` with `{container, well?}` gives its ledger.
- `inventory.overview` is the Inventory page as data: each reagent (product) or material (entity) with its lots (with the vendor's lot `number`) or samples, the containers holding them with their place path, how much liquid is left (`amount`) and the earliest expiry (`expired` when it has passed). Filter with `place` (everything inside a location, however deep), `type` (`reagents` or `materials`) or `text`. An entity that names a product (a cell line and its vendor vial) is one row with the product under `linked`. Products and entities with nothing in stock are under `notInStock`. Use it for "what do we have, where, how much, until when" before reading single records.
- `inventory.where_is` with `{of}` (a lot, sample or product id) answers "where is it and how much is left": every container holding it, with its place path and the wells, volumes and concentrations. A product covers all its lots. Discarded containers are left out.
- Recording what happened at the bench (all proposals from an agent): `inventory.fill` with `{container, fills: [{wells: ["A3:P22"], volume, components, assumed?}]}` for liquid from outside the inventory (components are lots or samples with their concentration); `inventory.transfer` with `{transfers: [{from: {container, well}, to: {container, well}, volume}], runLog?}` (with `runLog`, the instrument report file it is read from, it is recorded directly, once per report; `transfers.import_report` does this for Echo reports); `inventory.consume` with `{container, wells, volume}`; `inventory.correct` with `{container, wells, state, reason}` for a measurement.
- Plate onto plate: `inventory.map_plates` shows which well lands where (`{from, to, mapping: {type: "one_to_one"} | {type: "quadrant", quadrant: 1-4} | {type: "offset", rows, columns}, wells?}`); `inventory.stamp` with `{from, to, mapping, volume, wells?}` records it.
- `inventory.lineage` with `{container, well, depth?}` traces where a well's liquid came from.
- `inventory.effective_rules` with `{container, wells?}` gives the handling rules the container inherits from what it holds (time out of the incubator, light, cold, freeze-thaws) and its narrowest storage temperature, the strictest winning, each with the rules and records it came from. Quote the source when you tell a person a limit ("30 min, from the Cell line kind"), and say so when `conflict` is set.
- `inventory.discard` with `{container, expectedVersion, reason?}` when something is thrown away; empty a box first.
- A tube or trough is well `A1`. Mark estimates `assumed: true`. Read `warnings` in the result (a well below its dead volume) and tell the person.

## Samples

A batch the lab made (a miniprep, PCR product, purified protein, culture, cell bank) is a **sample** (`SMP-0001`): `samples.register` with `{label, entity, method, made?, madeBy?, derivedFrom?, qc?: [{key, value, measured?, method?}], notes?}`. QC values are quantities (`{"value": "185", "unit": "ng/uL"}`), `true`/`false` or short text, one per key. Then fill its tubes with `inventory.fill`, the sample as the component. Bought things and recipe batches are lots, not samples.
