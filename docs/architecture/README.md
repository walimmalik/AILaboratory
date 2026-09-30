# Architecture

The system-level architecture is in [plan 000](../plans/000-foundation-architecture.md). This folder holds one living document per module, created when the module's first plan lands and updated in the same PR as its code.

| Module | Doc | Plan |
| --- | --- | --- |
| Core records (IDs, units, versioning, links, actors) | [core-records.md](core-records.md) | 002 |
| Operation registry, REST, MCP, proposals and activity ledger | [operations.md](operations.md) | 003 |
| Web app: shell, sign-in, live ledger, proposals, records | [web-app.md](web-app.md) | 004a |
| In-app assistant: model adapters, tool loop, conversations, panel | [assistant.md](assistant.md) | 004b |
| Draft and confirm (evidence, sections, readiness, Review page) | [core-records.md](core-records.md), ADRs 0021 and 0022 | 004c, 004d |
| Lab memory | not yet written | 005 |
| Labware types, vendors, Opentrons import and export, seed loader | [labware.md](labware.md) | 007 |
| Instrument and equipment kinds, capability catalog, configuration resolver | [instruments.md](instruments.md) | 008 |
| Products, kits, lots, liquid types and classes | [reagents.md](reagents.md) | 009 |
| Entities, samples, containers, locations, ledger | [inventory.md](inventory.md) | 010 |
