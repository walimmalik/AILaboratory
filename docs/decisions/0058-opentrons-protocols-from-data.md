# 0058: Opentrons protocols written from data and checked in the simulator

- Status: accepted
- Date: 2026-10-01
- Plan: 016 (016b-3)

## Context

Plan 016 (T1, T3, T5, T6 and its defaults) says the Opentrons Flex protocol for a transfer plan is written by code, checked in Opentrons' own simulator before export, with tip use from the T5 default rules where we write the protocol, and a deck layout per instrument step. The simulator is Python (the `opentrons` package), so the check runs in the science service. Running a protocol in the simulator means executing it as Python, so whatever the service is sent to simulate it runs.

## Options

1. The API writes the protocol text and posts it to the science service, which simulates whatever it is given.
2. The API works out the protocol's data (pipette and mount, trash, tip racks and their slots, labware and their slots or custom definitions, and each transfer with whether it takes a new tip) and posts that; the science service validates it, writes it into one fixed program as Python literals, and simulates the result.

## Decision

Option 2.

- **The wire format** is `FlexProtocolRequest` (`packages/schema/src/transfers.ts`), mirrored by pydantic models in `apps/science/src/science/opentrons/protocol.py`. Every string is written with `repr`, so nothing in a request becomes code. The service refuses unknown keys, pipettes it doesn't know, slots off the deck, two things on one slot and transfers naming labware not loaded.
- **The simulator** runs in its own process with a five-minute limit (`python -m science.opentrons.simulate`), and reports `{ok, simulator, commands, tips, problem}`. `transfers.export` stores the protocol only when it passes; otherwise the group is skipped with the simulator's reason, or refused when asked for by name.
- **Opentrons 10.0.0, API level 2.20,** pinned. Flow rates are the pipette's defaults; the liquid class is not applied yet.
- **Pipettes and fixtures** are named by Opentrons, so their names are code in `apps/api/src/transfers/opentrons.ts`, matched on the equipment kind's model (pipettes) or label (`Flex Trash Bin`, `Flex Waste Chute`). Flex 1- and 8-channel 50 and 1000 µL pipettes are written; an 8-channel pipette picks up one tip at its H1 nozzle (Opentrons' single-nozzle layout), so it moves one well at a time. 96-channel pipettes and column-wise 8-channel transfers are not written yet.
- **Tips** follow `tipChanges` in `packages/domain` (T5): one pipette carries one tip, so a tip is reused only by the next transfer from the same source, and (lab default) never after it has touched liquid in a destination well. `countTips`, and so `transfers.check`, counts the same way. The tip rack is the lab's confirmed Opentrons Flex tip rack the pipette takes: the smallest that holds the largest transfer in one go, else the largest; one rack per 96 tips.
- **The deck**, until 016b-4 stores it on the plan: the plan's plates in its order, then the tip racks, on the free slots front row first (D1 to A3), skipping every slot the instrument's configuration claims (modules, trash, waste chute). A labware type without an Opentrons load name is loaded from the definition 007 writes for it (`toOpentrons`).

## Consequences

- The science service never runs code it was sent; a protocol is always the fixed program plus data a person can read at the top of the file.
- The protocol and the request are golden files (`apps/science/tests/fixtures/`): the API test checks it sends that request, and the science tests write it byte for byte and run it in the simulator. A change on either side fails one of them.
- The science service must be running to export Flex protocols, as for library imports.
- "Checked in the simulator" is all the export claims: the file says it was not run on a robot by AILaboratory (product rule 10).
