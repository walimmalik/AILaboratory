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
| [008 Instruments](../plans/008-instrument-library.md) | Instrument and equipment kinds, registered instruments, configurations, capabilities, workcells | 008a built (PRs #31, #32, ADR 0025); 008b registered instruments (PRs #33, #34, ADR 0026); 008c screens | 008a to 008d (008d workcells gets a short question round first) |
| [009 Reagents and liquids](../plans/009-reagents-and-liquids.md) | Products, kits, recipes, lots, handling rules, liquid types and classes | 009a built (PRs #36, #37, ADR 0027); 009b liquid classes (PRs #38, #39, ADR 0028); 009c search (PR #40) and screens; 009 done | 009a to 009c |
| [010 Inventory](../plans/010-inventory.md) | Entities, samples, containers, locations, barcodes, volume ledger, inherited handling rules | 010a entity kinds, entities and seed (ADR 0029); 010b locations, containers and barcodes (ADR 0030); 010c contents, ledger, samples, stamping and lineage (ADR 0031); 010d inherited handling rules (ADR 0032); 010e screens (lists, places, container page, scan page) | 010a to 010e |

## Knowledge and experiments

| Plan | Delivers | Status | Split |
| --- | --- | --- | --- |
| [011 SOP and literature library](../plans/011-sop-library.md) | File store, documents, parsing, hybrid search, mining mentions | 011a built: file store (ADR 0033), documents, folder import, seed; 011b-1 text and keyword search (ADR 0034); 011c mentions (ADR 0035); 011d screens; 011b-2 Docling and embeddings wait for laptop checks | 011a to 011d |
| [012 Digital SOPs](../plans/012-digital-sops.md) | Structured SOPs with typed steps and variables, the digitizer, AI review loop, benchmark | 012a built: formulas (ADR 0036), the SOP record (ADR 0037) and the seed loader; 012b binding next | 012a to 012d |
| [013 Campaigns and experiments](../plans/013-campaigns-and-experiments.md) | Campaigns, experiments, runs, sets, protocol binding, run recording | Locked; after 012 (013a can start after 010a) | 013a to 013d |
| [014 Plate map designer](../plans/014-plate-map-designer.md) | Layout templates, plate maps, the plate editor | Locked; after 013a and 010c | 014a, 014b |
| 015 Twin port | echo650-twin twins into `packages/twin`, bound to the instrument registry | Not started | |
| [016 Transfer designer](../plans/016-transfer-designer.md) | Transfer plans, the dilution optimizer and other calculators, deck layouts, worklists, run logs | Locked; after 014a and 009b. Worklist examples are mocked in `seed/worklists/` until real exports exist | |
| [017 Experiment designer](../plans/017-experiment-designer.md) | Assay templates, custom builder, the designer, factorial designs | Locked; after 013d, 014 and 016a | |
| [018 Workflow creator](../plans/018-workflow-creator.md) | Workflows as one-work-unit graphs chaining SOPs and transfer plans, labware paths, timing windows and handling rules with sources, the schedule request for 019 | Locked; after 012, 014a and 016a | 018a to 018c |
| [019 Scheduler and orchestrator](../plans/019-scheduler-and-orchestrator.md) | Schedules for one or more workflows across the workcell (planned in detail, run by Cellario), standalone instruments and people; carries, calendars and bookings, science-aware margins with stress cases, Gantt and simulation, prep lists, live re-planning | Locked; after 018a (019b's calendar after 008b) | 019a to 019e |
| [020 Analysis](../plans/020-analysis.md) | Reader imports, analysis templates and a vetted method catalog (4PL, Z', initial rates, tests), Vega-Lite graphs with a format panel, exclusions, hits to sets and verdicts, exploration across runs, power and drift | Locked; after 013c and 014a | 020a to 020g |

## Later

| Plan | Delivers |
| --- | --- |
| 021 Lab notebook | Entries on top of the event log plus free writing |
| 022 Device gateway | Python gateway implementing capability contracts on real hardware; Cellario hand-off |

## Build order

Keep the dependencies in the plan rows, but choose each next thin slice for the ELISA acceptance journey below. At the architecture review baseline (`0a5ca53`, 2026-09-30), the registries, inventory and document-library screens exist, and the SOP schema, formulas and draft seed loader have landed. SOP binding is the next open slice. The experiment, plate-map, transfer, workflow, scheduler and analysis designers remain planned; their locked decisions do not mean their workflows have passed acceptance.

## Next acceptance milestone

Wali chose **one complete, scientifically trustworthy ELISA journey first** on 2026-09-30. Agents remain central: they prepare the work through operations, show evidence and unknowns, ask for consequential missing inputs, and hand the person a linked, reviewable result.

The original foundation target ends at a worklist. That first usable path needs the transfer designer (016), as well as the registries, SOP and plate map. A complete assay journey also includes recording the run and reviewing analysis. Build only the required slices of those modules before broadening to more assay families; do not require the full future designer catalog merely to demonstrate the first assay.

Proposed acceptance evidence, to refine in the affected numbered plans before implementation:

1. A source-linked ELISA SOP and only its needed labware, reagent lots and instrument configuration are reviewed. Missing values and assumptions remain visible; calculator operations supply scientific numbers.
2. The agent drafts a plate map and transfer plan. The person can understand well roles, quantities, source containers and destinations, and can correct a missing input without navigating through unrelated registries.
3. Every proposed inventory change shows its concrete effects before confirmation. Concurrent operations preserve quantities, and open pages show the confirmed state promptly.
4. Confirmed designs use explicit versions of scientific inputs. Adopting a new definition is visible and deliberate; run preparation checks current physical inventory, equipment availability, calibration and safety.
5. The exported worklist has deterministic validation against the selected capability contract. Simulation and export evidence are distinguished from physical instrument validation.
6. Run recording distinguishes measured, entered and estimated observations. Analysis links its results to the input file, plate map, run and method versions and exposes quality failures for review.
7. The UI passes the approved bench-console direction with the assistant open: a proportioned plate grid, aligned labels, usable well selection, readable readiness actions and a clear next step. History and technical detail remain available without dominating the task.

The architecture review's defects, reproductions and recommendations belong in its PR description. This milestone does not approve the unresolved run-binding, reservation-ownership or scientific-timing choices. Record those decisions in the affected plans and ADRs. The agreed directions for pinning confirmed inputs and validating configurations before confirmation are in [plan 000](../plans/000-foundation-architecture.md#5-plan-sequence).
