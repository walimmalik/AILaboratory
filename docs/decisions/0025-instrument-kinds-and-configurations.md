# 0025: Instrument kinds, equipment kinds and configurations

- Status: accepted
- Date: 2026-09-29
- Plan: 008 (round 1, I1 to I9; step 008a)

## Context

Plan 008 chose records for instrument and equipment kinds (I1), echo650-twin's configuration graph, mounts, sites and capability providers without motion or visuals (I2), the physically installed configuration as the instrument's configuration (I3), records only for serial-bearing parts (I4), capabilities as contracts in code (I5), and manual stations as instrument kinds a person works (I6). This ADR records how 008a builds that on the record service, following ADR 0023.

## Options

1. **Two record kinds with sections and checks, a capability catalog in `packages/schema`, and a pure resolver in `packages/domain`** behind a read operation. Drafting, editing and confirming kinds use `records.*`.
2. Instrument-specific draft operations (`instruments.draft_kind`, `instruments.draft_equipment_kind`) as first listed in the plan. They would duplicate `records.create` (ADR 0023, product rule 1).

## Decision

Option 1.

- **Kinds.** `instrument_kind` (`ink_`, `INK-0001`) and `equipment_kind` (`eqk_`, `EQK-0001`), both linking to their vendor (`made_by`). Sections: Identity; Mounts and sites (equipment: Fit, mounts and sites); Capabilities.
- **Capability catalog (I5).** `capabilityCatalog` in `packages/schema/src/instruments.ts`: an id, a label, what it means and which limits a provider should give. Adding a capability is a code change. `instruments.capabilities` lists it.
- **Limits are data.** A capability provider on a kind carries typed limits (volume range and step, channel counts, temperature with `minAboveAmbient` for heaters without cooling, speed, force, wavelengths, plate formats, capacity) and, optionally, the sites where it happens.
- **Manual stations (I6)** are instrument kinds with `performedBy: "person"`; the resolved capabilities carry who performs them.
- **Mounts** have a layout (`fixed`, `slots` or `rail`), the fit tags they accept, who changes them (`factory`, `service`, `operator`, `robot`) and roughly how long a change takes. echo650-twin's `surface` layout is left out until something needs free placement.
- **Equipment** says which mounts it fits (tags), and optionally the only slots it may use, the extra slots it takes when placed in a slot (the Flex thermocycler in B1 also takes A1; the 96-channel pipette on the left mount also takes the right), or how many tracks it takes on a rail (a STAR carrier takes 6).
- **Sites** hold labware. A site may sit on a mount place (a Flex deck slot); equipment placed there covers it and offers its own sites instead.
- **Configuration** is a list of equipment nodes: a node key, its equipment kind, its parent node (the instrument when absent), the mount and a placement (`fixed`, `slot` or `rail` with a start track). 008b stores it on registered instruments with history.
- **Resolving** (`resolveConfiguration` in `packages/domain/src/instruments.ts`, exposed as `instruments.resolve`) returns the claims, sites, capabilities with limits and issues. It never saves anything. Errors: duplicate node, unknown kind, unknown parent, cycle, unknown mount, equipment the mount doesn't accept, wrong kind of placement, unknown slot, slot not allowed, off the end of the rail, overlap. A draft kind gives a warning. Nothing is placed on equipment that failed, and failed equipment adds no sites or capabilities.
- **Ported validators.** echo650-twin's footprint and carrier overlap, allowed module slots and pipette mount combinations are all expressed as claims. The Flex rule that a staging-area slot can't sit next to a powered module in column 3 is not modelled yet.

## Consequences

- Capabilities come from what is installed: removing the gripper removes `move_labware`.
- Registered instruments (008b) reuse `Configuration` and the resolver; changes to a configuration are checked against the whole graph before they are saved.
- The scheduler, transfer designer and later twins read resolved configurations, not the kind alone.
- Site compatibility with labware geometry (footprint, height) is declared on sites now and checked when labware is placed (008c and 016).
