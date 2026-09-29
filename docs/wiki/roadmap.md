# Roadmap and status

The plan sequence comes from [plan 000, section 5](../plans/000-foundation-architecture.md). Status as of 2026-09-29.

- **Built** means merged to `main`.
- **Locked** means every decision is chosen and the plan is ready to build.
- **In planning** means question rounds are still running; don't build from it yet.
- **Not started** means no plan file exists yet.

## Platform

| Plan | Delivers | Status |
| --- | --- | --- |
| [000 Foundation](../plans/000-foundation-architecture.md) | Architecture, repo rules, plan sequence; D1 to D7 | Locked |
| [001 Repo skeleton](../plans/001-repo-skeleton.md) | Monorepo, AGENTS.md, CI, compose, Dockerfiles | Built (PR #1) |
| [002 Core records](../plans/002-core-records.md) | Record envelope, IDs and names, units, history, links, actors | Built (PR #2) |
| [003 Operation registry](../plans/003-operation-registry.md) | Operations, REST, MCP, proposals, activity ledger, typed client | Built (PR #3) |
| [004 Agent shell](../plans/004-agent-shell.md) | 004a web shell, sign-in, ledger, records (PR #4); 004b assistant panel and model adapters (PR #5); 004c draft and confirm (PR #7, refined in PR #9); 004d one Review page (PRs #10, #11) | Built |
| 005 Lab memory | Conventions, quirks, lessons; scoped, linked, agent-proposed and person-confirmed; search and page context | Not started |
| [006 Seed lab](../plans/006-seed-lab.md) | The Demo Lab as YAML in `seed/`: 33 labware types, 16 instrument kinds and 18 instruments, 28 products, entities, lots and containers, 11 SOPs, 6 assay templates | Built (PR #6); each registry adds its loader |

## Registries

| Plan | Delivers | Status | Split |
| --- | --- | --- | --- |
| [007 Labware](../plans/007-labware-library.md) | Labware types, geometry, volumes, dead volumes, Opentrons import and export | 007a built (PR #13, ADR 0023); 007b in progress: Library pages, editing in place and to-scale drawings merged (PRs #16, #19) | 007a model and import, 007b screens |
| [008 Instruments](../plans/008-instrument-library.md) | Instrument and equipment kinds, registered instruments, configurations, capabilities, workcells | Locked; next to build | 008a to 008d (008d workcells gets a short question round first) |
| [009 Reagents and liquids](../plans/009-reagents-and-liquids.md) | Products, kits, recipes, lots, handling rules, liquid types and classes | Locked; after 008a | 009a to 009c |
| [010 Inventory](../plans/010-inventory.md) | Entities, samples, containers, locations, barcodes, volume ledger, inherited handling rules | Locked; after 009a | 010a to 010e |

## Knowledge and experiments

| Plan | Delivers | Status | Split |
| --- | --- | --- | --- |
| [011 SOP and literature library](../plans/011-sop-library.md) | File store, documents, parsing, hybrid search, mining mentions | Locked; after 009a | 011a to 011d |
| [012 Digital SOPs](../plans/012-digital-sops.md) | Structured SOPs with typed steps and variables, the digitizer, AI review loop, benchmark | Locked; after 011 | 012a to 012d |
| [013 Campaigns and experiments](../plans/013-campaigns-and-experiments.md) | Campaigns, experiments, runs, sets, protocol binding, run recording | Locked; after 012 (013a can start after 010a) | 013a to 013d |
| [014 Plate map designer](../plans/014-plate-map-designer.md) | Layout templates, plate maps, the plate editor | Locked; after 013a and 010c | 014a, 014b |
| 015 Twin port | echo650-twin twins into `packages/twin`, bound to the instrument registry | Not started | |
| [016 Transfer designer](../plans/016-transfer-designer.md) | Transfer plans, the dilution optimizer and other calculators, deck layouts, worklists, run logs | Locked; after 014a and 009b. Worklist examples are mocked in `seed/worklists/` until real exports exist | |
| [017 Experiment designer](../plans/017-experiment-designer.md) | Assay templates, custom builder, the designer, factorial designs | Locked; after 013d, 014 and 016a | |
| [018 Workflow creator](../plans/018-workflow-creator.md) | Workflows as one-work-unit graphs chaining SOPs and transfer plans, labware paths, timing windows and handling rules with sources, the schedule request for 019 | Locked; after 012, 014a and 016a | 018a to 018c |

## Later

| Plan | Delivers |
| --- | --- |
| 019 Scheduler and orchestrator | echo650 scheduler and exposure kernel, science-aware constraint pruning, twin simulation, booking |
| 020 Analysis | Templates, statistics, charts, agent analysis |
| 021 Lab notebook | Entries on top of the event log plus free writing |
| 022 Device gateway | Python gateway implementing capability contracts on real hardware; Cellario hand-off |

## Build order

007a is built and 007b is finishing; then 008a, then 009a. After 009a, 010 and 011 can proceed; 012 follows 011; 013 follows 012; 014, 016, 017 and 018 follow in the order their rows say. The first end-to-end target once 007 to 014 exist is **one ELISA**, from a digitized SOP to a plate map to a worklist, with the agent drafting each step.
