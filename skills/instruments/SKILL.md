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

## Registered instruments

- `instruments.register` with `{label, kind, shortName?, serial?, variant?, room?, configuration?}` drafts a real machine (`INS-0001`). Its configuration is checked first; a problem refuses it with every message.
- Change what is installed only with `instruments.change_configuration`: `{id, expectedVersion, changes: [...]}` where each change is `{"change": "place", "equipment": {id, kind, mount, placement, parent?, item?}}`, `{"change": "move", id, mount, placement, parent?}`, `{"change": "remove", id}` or `{"change": "set_item", id, item?}`. All changes apply together. On a confirmed instrument your change becomes a proposal the person approves.
- Serial-bearing parts (Flex pipettes, gripper, modules) can have their own record, kind `equipment_item` (`EQP-0001`, `{kind, serial}`), named by `item` on the node. One item is on one instrument at a time.
- `instruments.set_status` (`ready`, `in_use`, `maintenance`, `out_of_service`) and `instruments.log_service` (`{date, note, calibrationDue?}`) are always proposals from you.
- `instruments.resolve` with `{instrument}` shows what a registered instrument can do now and any problem in its stored configuration.

## Workcells

A workcell (`WCL-0001`) is the instruments that work together, such as the FlexPod with its Echo, PreciseDrop, LidValet, Mantis, sealer, peeler and centrifuge. It holds no positions, robots or reach: the digital twin does. Never ask a person for them.

- `workcells.draft` with `{label, twin, members: [{instrument, twinDevice, byHand}], notes?}`: `twin` is the echo650-twin workcell ID, `twinDevice` the device each member is in that twin, `byHand` whether people can also use it when the workcell isn't.
- `workcells.change_members` with `{id, expectedVersion, set?, remove?}` adds or replaces members by instrument and takes them out. On a confirmed workcell your change is a proposal.
- `workcells.of_instrument` with `{instrument}` says which confirmed workcell uses it and which drafts plan it; in none means it is used standalone.
- A person confirms it with `records.confirm_section` (section `members`). It can't be confirmed while a member is unconfirmed or in another confirmed workcell, or without the twin workcell and every twin device named. The twin mapping is recorded as given until the twin connection (plan 015) checks it.
