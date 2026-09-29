# 0026: Registered instruments and their configurations

- Status: accepted
- Date: 2026-09-29
- Plan: 008 (round 1, I3 and I4; step 008b)

## Context

008a (ADR 0025) added instrument and equipment kinds and a resolver for configurations. 008b adds the real machines: what is installed on each now, its status and its service record. The plan listed `instruments.register` as proposed for agents and a separate operating profile (`instruments.set_operating_values`). Draft and confirm (ADR 0021) came after the plan was written.

## Decision

- **Kinds.** `instrument` (`ins_`, `INS-0001`): the instrument kind, variant, short name (`FLX-01`), serial, room, `configuration`, `status`, `lastService`, `calibrationDue`, notes. Sections: Identity, Installed equipment, Status and service. `equipment_item` (`eqp_`, `EQP-0001`) for serial-bearing parts that move between instruments (I4): kind, serial, calibration due.
- **Where an item is** is read from the configurations that name it; items carry no location of their own, so there is one place to change. An item installed on one instrument is refused on another.
- **`instruments.register`** creates a draft after checking its configuration, directly for agents, like `records.create` and `labware.import_opentrons` (ADR 0023). A person still confirms it. This replaces the plan's "proposed", which predates draft and confirm.
- **`instruments.change_configuration`** takes typed changes (`place`, `move`, `remove`, `set_item`), applies them together, resolves the whole configuration with the lab's kinds and items, and refuses it with every problem if anything fails. Removing equipment that has other equipment on it is refused and names what sits on it. Agents: direct on drafts, proposed on confirmed instruments.
- **Status and service** are attributes; each change is a version, so the record's history is the service log. `instruments.set_status` and `instruments.log_service` are always proposed for agents.
- **`instruments.resolve`** also takes a registered instrument and resolves its current configuration.
- **Deferred:** operating profiles (`instruments.set_operating_values`) wait until a twin or method needs defaults, and live state waits for twins and the gateway (015, 022).

## Consequences

- `records.update` can still write a configuration without the resolver; the skill tells agents to use `instruments.change_configuration`, and `instruments.resolve` shows any problem in a stored one.
- The scheduler (019) books instruments by status and calibration date; configuration history lets it see what a change costs later.
