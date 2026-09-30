# 0030: Locations as a tree, containers named by family and held in racks

- Status: accepted
- Date: 2026-09-30
- Plan: 010

## Context

Plan 010, V5 and V6 (accepted by Wali on 2026-09-29, both A): a container's readable name is its lab barcode (`PLT-000345`), and pre-barcoded labware keeps its own code as an extra barcode that also resolves. Things that don't move (rooms, fridges, freezers, shelves) are a location tree; things that move and hold other things (freezer boxes, SBS tube racks) are containers with positions from their labware type, so moving a box moves what is in it.

Every kind so far has one readable name prefix. Containers need one per labware family, and the record service has to reserve all of them so no entity kind takes `PLT`.

## Options

1. One `container` kind named with its family's prefix through `related` (ADR 0029), with the family prefixes declared on the kind so they are reserved.
2. One code kind per family (`plate`, `tube`, `rack`…): six kinds sharing every rule, and a plate type changing family would change kind.
3. One prefix for all containers (`CNT-000001`): the name no longer says what the thing is, which V5 relies on.

## Decision

Option 1.

- `KindDefinition.otherNamePrefixes` lists further readable prefixes a kind hands out; the registry keeps them unique across kinds and `reservedPrefixes` includes them.
- **Location** (`loc_`, `LOC-0001`): type (room, fridge, freezer, cryostore, incubator, cold room, shelf, cabinet, bench, automated store, other), parent location, setpoint, CO2, the instrument it is (a Cytomat), notes. The parent chain must exist and not loop.
- **Container** (`lw_`, named `PLT-`, `RES-`, `TUB-`, `BOX-`, `TIP-`, `LID-` + 6 digits by its labware type's family): labware type, place (a location, or a position of a rack or box), external barcodes (manufacturer, vendor or earlier system), status (in use, empty, discarded), sealed, lidded, a description of what it holds until 010c. The type's family can't change. A holder must be a rack-family container whose type has the position; a position holds one container that isn't discarded; a box can't end up inside itself; an external barcode belongs to one container in the lab. A labware type that is still a draft is a readiness warning.
- `inventory.scan` resolves a readable name (case and dash optional: `plt000345`) or an external code, with the full place path.
- Registering, moving and creating locations are proposals when an agent does them (V7: no scenario auto-confirms at launch).

## Consequences

- Flasks and dishes wait for labware families of their own (007); `FLK-` from the plan's table isn't a prefix yet.
- Label printing (Code 128 and DataMatrix, V5) needs a barcode library and a check that the lab's readers accept the dash; deferred.
- Contents, volumes and the ledger come in 010c; `description` carries what a container holds until then.
- `inventory.list_place` and scans read all containers in the lab; fine at lab scale, to be indexed if it grows.
