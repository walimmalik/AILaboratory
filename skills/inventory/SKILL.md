---
name: ailab-inventory
description: Find where plates, tubes and boxes are in AILaboratory, resolve barcodes, register new containers and move them between freezers, shelves and box positions, through its MCP tools.
---

# Inventory in AILaboratory

A **location** (`location`, `LOC-0001`) is a place that doesn't move: a room, fridge, freezer, shelf, incubator or automated store, inside a parent location. A **container** (`container`, `lw_…`) is one physical plate, tube, reservoir, rack or freezer box, tip rack or lid, of a labware type. Its readable name is its lab barcode: `PLT-000001` for plates, `TUB-` tubes, `RES-` reservoirs, `BOX-` racks and boxes, `TIP-` tip racks, `LID-` lids. What a container holds (samples, lots, volumes) comes later; until then its `description` says it in words.

## Finding

- `inventory.scan` with `{code}` resolves anything a person reads or scans: a readable name in any case, with or without the dash (`plt000001`), or a code printed by the manufacturer or vendor (a FluidX tube). It returns the record and its place path, e.g. Cold room › Freezer -80 1 › BOX-000002 › TUB-000001 at A1.
- `inventory.list_place` with `{place, deep?}` lists what is directly in a location or a box; `deep: true` lists everything under it, with each container's position and path.
- `records.list` with `kind: "location"` gives the whole tree.

## Registering and moving

All of these are proposals from an agent: a person approves them.

- `locations.create` with `{label, type, parent?, setpoint?, co2?, instrument?, notes?}`. Setpoints carry units: `{"value": "-80", "unit": "degC"}`.
- `inventory.register_containers` with `{labwareType, containers: [{place?, barcodes?, sealed?, lidded?, description?, notes?, label?}], reason?}`: up to 96 of one labware type, all or none. `place` is `{location}` or `{container, position}` for a position in a box (`"B3"`). Put printed codes in `barcodes: [{code, from: "manufacturer" | "vendor" | "earlier_system"}]`; don't invent lab barcodes, the name is one.
- `inventory.move` with `{container, expectedVersion, to, reason?}`. Moving a box moves what is in it.

Refused, with the reason: a position the box doesn't have, a position already holding something, a holder that isn't a rack or box, a box inside itself, an external code already on another container, a location loop, a labware type or location from another lab. Look first (`inventory.list_place` on the box) before picking a position.

## Contents

What a well holds is a `WellState` (see `skills/calculators`). To know what a transfer leaves behind, call `inventory.calculate_transfer`; don't work concentrations out yourself.
