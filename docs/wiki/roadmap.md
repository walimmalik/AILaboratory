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
| [004e Review v2 and agent context](../plans/004e-review-v2-and-agent-context.md) | Review in tiers with addressees, change sets and batch confirm; evidence by path; honest counts and plain words; "what changed since I last looked"; skills and a smaller toolset for agents; people parity | Locked 2026-09-30 (R1 to R12 all as recommended); goes before 013c, 014a, 016a and 017; built as 004e-1 to 004e-6 |
| [005 Lab memory](../plans/005-lab-memory.md) | Conventions, preferences, quirks, lessons and facts linked to records with conditions and strength; page context and `memory.for` for design tools; people add, agents ask or propose; detectors, weights and decay | Locked 2026-09-30 (M1 to M22 all as recommended, plus 7 changes from the adversarial review); before 017 (005a, 005b); 005c-1 once designs exist, 005c-2 once a detector reports negatives; built as 005a to 005d |
| [006 Seed lab](../plans/006-seed-lab.md) | The Demo Lab as YAML in `seed/`: 33 labware types, 16 instrument kinds and 18 instruments, 28 products, entities, lots and containers, 11 SOPs, 6 assay templates | Built (PR #6); each registry adds its loader |

## Registries

| Plan | Delivers | Status | Split |
| --- | --- | --- | --- |
| [007 Labware](../plans/007-labware-library.md) | Labware types, geometry, volumes, dead volumes, Opentrons import and export | 007a built (PR #13, ADR 0023); 007b in progress: Library pages, editing in place and to-scale drawings merged (PRs #16, #19) | 007a model and import, 007b screens |
| [008 Instruments](../plans/008-instrument-library.md) | Instrument and equipment kinds, registered instruments, configurations, capabilities, workcells | 008a built (PRs #31, #32, ADR 0025); 008b registered instruments (PRs #33, #34, ADR 0026); 008c screens | 008a to 008d (008d workcells: round 2 answered, ready to build) |
| [009 Reagents and liquids](../plans/009-reagents-and-liquids.md) | Products, kits, recipes, lots, handling rules, liquid types and classes | 009a built (PRs #36, #37, ADR 0027); 009b liquid classes (PRs #38, #39, ADR 0028); 009c search (PR #40) and screens; 009 done | 009a to 009c |
| [010 Inventory](../plans/010-inventory.md) | Entities, samples, containers, locations, barcodes, volume ledger, inherited handling rules | 010a entity kinds, entities and seed (ADR 0029); 010b locations, containers and barcodes (ADR 0030); 010c contents, ledger, samples, stamping and lineage (ADR 0031); 010d inherited handling rules (ADR 0032); 010e screens (lists, places, container page, scan page) | 010a to 010e |

## Knowledge and experiments

| Plan | Delivers | Status | Split |
| --- | --- | --- | --- |
| [011 SOP and literature library](../plans/011-sop-library.md) | File store, documents, parsing, hybrid search, mining mentions | 011a built: file store (ADR 0033), documents, folder import, seed; 011b-1 text and keyword search (ADR 0034); 011c mentions (ADR 0035); 011d screens; 011b-2 Docling and embeddings wait for laptop checks | 011a to 011d |
| [012 Digital SOPs](../plans/012-digital-sops.md) | Structured SOPs with typed steps and variables, the digitizer, AI review loop, benchmark | 012a built: formulas (ADR 0036), the SOP record (ADR 0037) and the seed loader; 012b binding roles and reading record values built; 012c open questions, citation checks, the digitizer skill and the AI review cycle (ADR 0038) built; 012d SOP page built; the digitizing benchmark built (InterLab expectation; the others need a hand check) | 012a to 012d |
| [013 Campaigns and experiments](../plans/013-campaigns-and-experiments.md) | Campaigns, experiments, runs, sets, protocol binding, run recording | 013a campaigns, experiments and runs built with the demo campaigns, pinned to SOP versions ([ADR 0039](../decisions/0039-designs-pin-inputs.md)); 013b binding roles and inputs built (reservations come with 016); 013c run recording, conclusions and sets and 013d screens built; plan done | 013a to 013d |
| [014 Plate map designer](../plans/014-plate-map-designer.md) | Layout templates, plate maps, the plate editor | 014a-1 placement rules built (regions, series, replicates, every strategy, overrides); 014a-2 layout templates with a preview calculator and five seed layouts ([ADR 0043](../decisions/0043-layout-templates.md)); 014a-3 plate maps (wells worked out from the pinned layout, hand edits, CSV export); 014b screens: layouts and plate maps, changing wells by hand, save as layout; plan 014 built | 014a, 014b |
| 015 Twin port | echo650-twin twins into `packages/twin`, bound to the instrument registry | Not started | |
| [016 Transfer designer](../plans/016-transfer-designer.md) | Transfer plans, the dilution optimizer and other calculators, deck layouts, worklists, run logs | 016a-1 transfer math and the dilution optimizer built (volume fitting to droplets, direct dispense, backfill, dilution options, source volumes, tips, device ranking, intermediate plates) the calculator operations (016a-2) and transfer plans with soft reservations (016a-3) and drafting from plate maps (016a-4) built; Echo pick list export (016b-1) and report import (016b-2) built; Opentrons protocols next. Worklist examples are mocked in `seed/worklists/` until real exports exist | 016a to 016d |
| [017 Experiment designer](../plans/017-experiment-designer.md) | Assay templates, custom builder, the designer, factorial designs | Locked; after 013d, 014 and 016a | |
| [018 Workflow creator](../plans/018-workflow-creator.md) | Workflows as one-work-unit graphs chaining SOPs and transfer plans, labware paths, timing windows and handling rules with sources, the schedule request for 019 | Locked; after 012, 014a and 016a | 018a to 018c |
| [019 Scheduler and orchestrator](../plans/019-scheduler-and-orchestrator.md) | Schedules for one or more workflows across the workcell (planned in detail, run by Cellario), standalone instruments and people; carries, calendars and bookings, science-aware margins with stress cases, Gantt and simulation, prep lists, live re-planning | Locked; after 018a (019b's calendar after 008b) | 019a to 019e |
| [020 Analysis](../plans/020-analysis.md) | Reader imports, analysis templates and a vetted method catalog (4PL, Z', initial rates, tests), Vega-Lite graphs with a format panel, exclusions, hits to sets and verdicts, exploration across runs, power and drift | Locked; after 013c and 014a | 020a to 020g |
| [021 Lab notebook](../plans/021-lab-notebook.md) | Dated entries linked to any records, Markdown with pinned embeds, a timeline computed from the activity ledger, agent drafts on request, notes that propose run records, search and PDF export | Locked 2026-09-30 (N1 to N12 all as recommended); after 020 (021a can start earlier) | 021a to 021d |

## Later

| Plan | Delivers |
| --- | --- |
| 022 Device gateway | Python gateway implementing capability contracts on real hardware; Cellario hand-off |

## Build order

007a is built and 007b is finishing; then 008a, then 009a. After 009a, 010 and 011 can proceed; 012 follows 011; 013 follows 012; 014, 016, 017, 018, 019 and 020 follow in the order their rows say. 004e (review v2 and agent context) goes before 013c, 014a, 016a and 017, and 005 lab memory before 017 (Wali, 2026-09-30). The first end-to-end target once 007 to 014 exist is **one ELISA**, from a digitized SOP to a plate map to a worklist, with the agent drafting each step.
