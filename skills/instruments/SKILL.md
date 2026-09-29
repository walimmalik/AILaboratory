---
name: ailab-instruments
description: Draft instrument and equipment kinds (liquid handlers, readers, modules, pipettes, carriers, manual stations) in AILaboratory and check instrument configurations through its MCP tools.
---

# Instruments in AILaboratory

An **instrument kind** (`instrument_kind`, `INK-0001`) is a model: Hamilton STAR, Opentrons Flex, a plate reader, or a manual station such as a bench or a biosafety cabinet. An **equipment kind** (`equipment_kind`, `EQK-0001`) is a part that attaches to an instrument: a pipette, head, gripper, module, carrier, adapter or chip. Create, edit and confirm both with `records.*` (see the records skill); read `records.kinds` for the full schemas.

## Capabilities

`instruments.capabilities` lists the catalog: `transfer`, `dispense`, `move_labware`, `read_absorbance`, `incubate` and so on, what each means and which limits a kind should give. Only catalog capabilities are accepted; if something is missing, say so to the person rather than picking a near match.

A kind lists what it can do in `capabilities`: `[{"capability": "transfer", "limits": {"volume": {"min": {"value": "5", "unit": "uL"}, "max": {"value": "1000", "unit": "uL"}}, "channels": [1, 8]}}]`. Limits: `volume`, `volumeStep`, `channels`, `temperature` (`degC`; `minAboveAmbient` for heaters that can't cool), `speed` (`rpm`), `force` (`xg`), `wavelengths` (`nm`; `fixed` filters or a `min`/`max` range), `wellCounts`, `capacity`, `note`.

Put a capability on the part that provides it: on the Flex, `transfer` belongs to each pipette and `move_labware` to the gripper, not to the Flex itself. A fixed instrument like a plate reader lists its capabilities on the instrument kind.

Manual stations use `category: "manual_station"` and `performedBy: "person"`; everything else is `performedBy: "machine"`.

## Mounts, sites and fit

- `mounts` on an instrument or equipment kind: `{"id": "deck", "label": "deck", "layout": {"layout": "slots", "slots": ["A1", "A2"]}, "accepts": ["flex_module"], "changedBy": "operator", "changeTime": {"value": "10", "unit": "min"}}`. Layouts: `fixed`, `slots`, `rail` (`tracks`, optional `pitch` in mm). `changedBy`: `factory`, `service`, `operator` or `robot`.
- `sites` hold labware: `{"id": "A1", "mount": {"mount": "deck", "slot": "A1"}, "accepts": {"sbs": true}}`. A site on a mount place is covered while equipment sits there.
- An equipment kind's `fits` lists the tags of mounts it goes on. `placement` narrows it: `slots` (the only slots allowed), `alsoClaims` (`{"B1": ["A1"]}` for the Flex thermocycler, `{"left": ["right"]}` for the 96-channel pipette), `tracks` (how many rail tracks, e.g. 6 for a STAR plate carrier).
- `serialized: true` for parts with a serial that move between instruments (Flex pipettes, gripper, modules).

## Checking a configuration

`instruments.resolve` with `{instrumentKind, configuration: {equipment: [{id, kind, mount, placement, parent?}]}}` returns `claims`, `sites`, `capabilities` and `issues`. Placements: `{"on": "slot", "slot": "C1"}`, `{"on": "rail", "track": 7}`, `{"on": "fixed"}`. `parent` is another node's `id` when a part sits on a part (an adapter on a heater-shaker). Use it before you describe what an instrument can do, and quote the issues' messages to the person. Draft kinds give a warning only.

## Evidence and review

Say where values came from in `evidence` (a datasheet URL, `imported` from the seed). Leave out what you don't know; readiness lists it. A person confirms Identity, Mounts and sites, and Capabilities.
