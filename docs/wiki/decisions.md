# Decision log

Every decision made so far, one line each. Links go to the full reasoning.

Question codes repeat across plans (002 and 016 both have T1 to T6; round 7 of 004 and plan 009 both start at R1), so this page writes them with the plan number: `002-T1`, `009-R1`.

Plans 006 to 019 record their decisions in the plan files; their ADRs are written when each plan is built (0023 for 007a, 0025 and 0026 for 008a and 008b so far). ADR 0024 applies to every plan.

## Architecture Decision Records

| ADR | Decision |
| --- | --- |
| [0001](../decisions/0001-typescript-core-python-science.md) | TypeScript core (API, web) plus a Python science service for statistics, curve fits, chemistry and sequences |
| [0002](../decisions/0002-postgres.md) | Postgres with pgvector as the one database |
| [0003](../decisions/0003-react-vite.md) | React and Vite for the web app; static SPA, no server rendering |
| [0004](../decisions/0004-port-echo650-twin.md) | Port echo650-twin's twins and scheduler into this repo (plans 015, 019); don't rebuild them |
| [0005](../decisions/0005-agent-runtime.md) | In-app agent over our MCP server; amended by 0020 |
| [0006](../decisions/0006-tenancy.md) | `org_id` and `lab_id` on every record from day one |
| [0007](../decisions/0007-local-compose-first.md) | Local Docker Compose first, internal Docker cluster later |
| [0008](../decisions/0008-tooling.md) | pnpm, Biome, Vitest, Hono, uv + ruff + pytest, strict TypeScript, Node 24 |
| [0009](../decisions/0009-history-as-snapshots.md) | History as current-state tables plus full version snapshots; restore writes a new version |
| [0010](../decisions/0010-exact-decimals.md) | Quantities are exact decimals, sent as strings |
| [0011](../decisions/0011-zod-schemas.md) | Zod 4 is the schema source; JSON Schema generated from it |
| [0012](../decisions/0012-drizzle.md) | Drizzle for tables and migrations; tests on PGlite |
| [0013](../decisions/0013-readable-ids.md) | Readable names are `PREFIX-000123`, per lab, never reused |
| [0014](../decisions/0014-links-table.md) | A `record_links` table kept in sync by the record service |
| [0015](../decisions/0015-operation-registry.md) | One operation registry behind REST, MCP and the typed client |
| [0016](../decisions/0016-agent-proposals.md) | Agents act directly on drafts and propose changes to active records; people approve |
| [0017](../decisions/0017-preview-by-rollback.md) | Preview runs the real write and rolls it back |
| [0018](../decisions/0018-activity-ledger.md) | An activity ledger of every write outcome, with a live stream |
| [0019](../decisions/0019-web-sign-in.md) | Email and password sign-in with an HttpOnly session cookie; bearer tokens for agents |
| [0020](../decisions/0020-own-agent-loop.md) | The in-app assistant runs our own tool loop with adapters for Anthropic, OpenRouter and OpenAI-compatible models |
| [0021](../decisions/0021-draft-and-confirm.md) | Draft and confirm: per-field evidence, section confirmations, derived confirmation, readiness checks |
| [0022](../decisions/0022-one-place-to-review.md) | One Review page, one verb ("Confirm"), and the last section's confirm activates the draft |
| [0023](../decisions/0023-labware-types.md) | Labware types are a record kind with sections and checks; drafting, editing and confirming go through `records.*`, with labware operations only for Opentrons import and export and the well list |
| [0024](../decisions/0024-lab-calculators.md) | Lab calculators: deterministic read operations every agent calls for volumes, dilutions, feasibility and totals, indexed by one skill |
| [0025](../decisions/0025-instrument-kinds-and-configurations.md) | Instrument and equipment kinds as records; capability catalog in code; mounts, sites, fit tags and claims; one resolver for every configuration |
| [0026](../decisions/0026-registered-instruments.md) | Registered instruments and equipment items; typed configuration changes checked as a whole; status and service as attributes with history as the log |

## 000 Foundation (D1 to D7, all as recommended)

D1 TypeScript core plus Python science (0001). D2 Postgres (0002). D3 React and Vite (0003). D4 port echo650-twin (0004). D5 agent over MCP (0005, now 0020). D6 org and lab IDs (0006). D7 Docker Compose first (0007).

Round 1 context: personal project to be adopted by an academic lab later; no regulation; real hardware later through a Python device gateway; start fresh with realistic seed data; built by Wali plus agents; runs on Windows now. [Plan 000, 3.1](../plans/000-foundation-architecture.md)

## 002 Core records (T1 to T6, all as recommended)

002-T1 snapshots (0009). 002-T2 exact decimals (0010). 002-T3 Zod 4 (0011). 002-T4 Drizzle (0012). 002-T5 `PREFIX-` plus counter (0013). 002-T6 links table (0014). Round 2 answers: full history for everything, archive instead of delete (only unlinked drafts can be deleted), units include cells/mL, OD600, %v/v, U/mL, CFU and ng/µL, agent attribution now and roles later. [Plan 002](../plans/002-core-records.md)

## 003 Operation registry (round 4)

Agents act directly on drafts and propose the rest (0016); two MCP tools, `describe_operations` and `run_operation`; outside agents including bring-your-own-key models; preview by rollback (0017); every write all-or-nothing; log changes only, with a live ledger (0018). Wali eventually wants autonomous agent execution and a live view of agent activity. [Plan 003](../plans/003-operation-registry.md)

## 004 Agent shell

- **Round 3 (UI):** left nav, center page, right agent panel; a global ask bar and a per-page panel; confirm section by section; track-changes highlighting plus a change list; desktop first, bench views tablet-friendly; the bench console design system (mockup v3).
- **Round 5 (all as recommended):** our own tool loop with model adapters (0020); keys in `.env`; password sign-in (0019); save every conversation; first screens use real data; split 004a, 004b, 004c.
- **Round 6, 004c (C1 to C6, all A):** a draft is a record with evidence and section reviews; anything an agent sets is assumed unless it names a source; an edited section goes back to review; highlight against the last confirmed values; readiness checks per kind in code; build against the test widget kind first (0021).
- **After first use:** a value the person told the agent is `stated`, not assumed; approving a proposal confirms the sections it touched.
- **Round 7, 004d (R1 to R6, all A):** one Review page; agent changes to active records stay proposals; one nav count; a "Waiting for you" line after assistant turns; one verb, "Confirm"; the last section's confirm activates (0022).

[Plan 004](../plans/004-agent-shell.md)

## 006 Seed lab (round 6)

Wali's real instrument list; assays are sandwich ELISA, single-point compound screen with dose-response follow-up (CellTiter-Glo or HiBiT), enzyme kinetic screen, Dual-Glo reporter, plasmid assembly (Gibson, Golden Gate) with purification; a fictional Demo Lab; YAML in `seed/`, vendor PDFs linked not committed; own SOPs plus openly licensed ones; kinds plus a small stocked lab. Every value is marked verified, estimated or unknown; no invented catalog numbers. [Plan 006](../plans/006-seed-lab.md)

## 007 Labware (L1 to L6, all as recommended)

| # | Decision |
| --- | --- |
| L1 | 007 is labware types only; physical plates and tubes, contents and locations belong to inventory (010) |
| L2 | Parametric grid plus an explicit well list for irregular labware; canonical well names `A1` to `AF48` |
| L3 | One labware kind with families: plate, reservoir, tube, rack, tip rack, lid (flask and dish added for 010) |
| L4 | Dead volume: a default on the type plus per-instrument-kind values, each with a source |
| L5 | Specs from Opentrons' library and echo650-twin's reviewed catalog, pasted datasheets, and agent knowledge marked estimated; web access for the in-app agent is its own later plan |
| L6 | Store each platform's name for the type and export Opentrons JSON; never generate Hamilton files. Nothing connects to instrument software yet; simulate first |

[Plan 007](../plans/007-labware-library.md)

## 008 Instruments (I1 to I9)

| # | Decision |
| --- | --- |
| I1 | Instrument and equipment kinds are records; twin and driver code attach optionally by ID |
| I2 | Adopt echo650-twin's configuration graph, mounts, sites, capability providers and operating profiles; kinematics and visuals wait for the twin port (015) |
| I3 | A configuration is what is physically installed now, versioned; each mount says who can change it and roughly how long it takes |
| I4 | Only serial-bearing parts that move between instruments (Flex pipettes, gripper, modules) are records |
| I5 | Capability contracts are code in `packages/schema`; limits per kind are data |
| I6 | Manual stations (bench, biosafety cabinet, hand multichannel) are instrument kinds whose capabilities a person performs |
| I7 | Model the lab's own instruments first (see [Registries](registries.md)) |
| I8 | Workcells are design documents built from registered instruments and FlexPods (step 008d) |
| I9 | An instrument is in at most one physically active workcell; others are used standalone |

[Plan 008](../plans/008-instrument-library.md)

## 009 Reagents and liquids (R1 to R12, all as recommended)

| # | Decision |
| --- | --- |
| R1 | 009 owns products and lots; 010 owns the containers holding a lot |
| R2 | Kit components are their own product records; a kit lot lists its component lots |
| R3 | Lab-made solutions are recipes; a batch is a lab-made lot traceable to its ingredients |
| R4 | Two layers: platform-neutral liquid types on products, per-device liquid classes; a resolver picks and explains |
| R5 | Full parameters only for Opentrons; Venus (STAR, Vantage, FeliX) stores the class name plus a read-only imported copy; Echo stores the calibration name. All classes editable; an edited Venus class shows "changed here, apply in Venus" |
| R6 | A typed handling-rule vocabulary defined here, shared with 010; each rule has a source and is enforced or advice |
| R7 | One class = one device, one tip or source plate type, one dispense mode, one volume range |
| R8 | A mixture's liquid type: the largest component, unless a listed solvent passes its threshold (at least 70% DMSO, over 20% glycerol); marked assumed |
| R9 | SOP variables link to lot-specific product fields; the value comes from the lot picked at planning |
| R10 | Quarantined lots are blocked; expired lots warn and need a reason to confirm |
| R11 | A class is "verified in this lab" only with a passing verification record from a real run; demo records never count |
| R12 | Seed classes from Opentrons shared-data (Apache-2.0) and PyLabRobot's Hamilton defaults (MIT); Echo names are plate type plus calibration (`384PP_DMSO2`) |

[Plan 009](../plans/009-reagents-and-liquids.md)

## 010 Inventory (V1 to V12, all as recommended)

| # | Decision |
| --- | --- |
| V1 | Entity kinds are records built on a base class from code (DNA, RNA, protein, chemical, cells, organism, other) with typed fields |
| V2 | Entity, then a sample (lab-made prep) or a lot (bought or recipe batch), then container contents |
| V3 | Wells know their full composition with amounts, concentrations and lineage |
| V4 | Append-only volume ledger; no negative volumes; below dead volume warns; "unknown" allowed; measured values replace computed ones with a reason |
| V5 | A container's readable name is its barcode; vendor barcodes also resolve |
| V6 | A fixed location tree; boxes and racks are containers that move |
| V7 | People record physical events directly; an agent's record is a proposal unless it comes from a run log or a run the person started. Autonomy is earned per scenario: confirm, edit and reject rates are kept, and a person can switch a scenario to auto-confirm. Nothing auto-confirms at launch |
| V8 | Confirmed plans soft-reserve stock; over-commitment warns |
| V9 | Sequences with features, GenBank and FASTA, SMILES, InChIKey and molecular weight, duplicate detection; no construct designer yet |
| V10 | One entity per library compound |
| V11 | Passage, confluence and cell count on flasks; banks are samples |
| V12 | An agent drafts spreadsheet imports; a person confirms |

[Plan 010](../plans/010-inventory.md)

## 011 SOP and literature library (S1 to S6, all as recommended)

S1 a library document and a digital SOP are two records. S2 a content-addressed file store on a Docker volume, S3-ready. S3 Docling in the science service converts documents. S4 hybrid search: Postgres full text plus pgvector. S5 embeddings local by default, an OpenAI-compatible provider optional; one model per lab, stored with every vector. S6 agents mine mentions and parameters, a person confirms. [Plan 011](../plans/011-sop-library.md)

## 012 Digital SOPs (G1 to G11, all as recommended)

G1 our own schema with fixed sections; LabOP as a test and import path. G2 typed steps from a fixed action vocabulary plus "manual". G3 a small expression language with units and exact decimals. G4 materials and instruments named by role, bound when an experiment is planned. G5 run-level inputs are typed variables. G6 unclear source text becomes open questions that block confirm. G7 variants are variables; structural changes make a derived SOP with a diff. G8 no nesting; composition belongs to templates (017) and workflows (018). G9 recording runs belongs to 013. G10 out: printable document; in: digitizer and LabOP. G11 a benchmark, plus an AI review loop that fixes what the source settles as tracked changes and asks where it is ambiguous. [Plan 012](../plans/012-digital-sops.md)

## 013 Campaigns and experiments (E1 to E12, all as recommended)

E1 campaign, experiment, run. E2 an experiment is the design; a run is one execution. E3 hypotheses with an optional testable prediction. E4 fixed stages, separate from record status. E5 experiments pin confirmed SOP versions and bind their roles and inputs. E6 013 builds the full experiment record; 017 adds templates. E7 the run view is a checklist: tick per step, "all done as planned", type only deviations. E8 a confirmed design is frozen per version. E9 runs attach data files; conclusions per hypothesis. E10 sets carry results to the next experiment. E11 agents draft; planning, concluding and stage changes are proposals. E12 everyone in the lab sees everything; owners and contributors for filters. [Plan 013](../plans/013-campaigns-and-experiments.md)

## Designers: 014 plate maps, 016 transfers, 017 experiment designer (all as recommended)

Locked 2026-09-29. Plans: [014](../plans/014-plate-map-designer.md), [016](../plans/016-transfer-designer.md), [017](../plans/017-experiment-designer.md).

- **Round 1 (P1 to P6, shared):** three linked documents (experiment, plate maps, transfer plans), each confirmed on its own; a plate map states intended contents only; layout templates plus plate maps; maps store the rules and the wells with overrides; the transfer plan picks containers and holds reservations; upstream changes mark confirmed documents "out of date" and redraft drafts.
- **Round 2, 014 (M1 to M6):** every placement strategy (in order, randomized, balanced across plates, edge handling) with stored seeds, and lab-made layout templates; a dilution series is one object; one plate map spans many plates; a layout is for one plate format; small edits by hand, bigger ones through the agent; wells carry analysis groups.
- **Round 3, 016 (016-T1 to T6):** code solves transfers exactly and the agent picks the method per group. Every worklist writer is built against an example file as a golden-file test (mocks in `seed/worklists/` until the lab has real exports); Echo and Opentrons writers are code, while Hamilton, Mantis and PreciseDrop CSVs are **worklist format** records an agent drafts from an example and a person confirms. Deterministic read operations do the math for agents and the UI: `transfers.options`, `transfers.dilution_options`, `transfers.source_volumes`, `transfers.check`. Echo CSV and Opentrons first, never Venus methods; Echo transfer reports imported and matched to the plan. Tip handling is declared by each instrument method, and the plan counts tips and warns on clashes; default tip rules apply only where we write the protocol (Opentrons). Deck layouts drafted and checked against the instrument's configuration.
- **Round 4, 017 (017-D1 to D7):** an assay template is a versioned, confirmed record; the custom builder is the agent drafting that same record, and any experiment can be saved as a template; the designer asks only a template's essential inputs; templates name capabilities and roles, bound to the lab's instruments by 016's tools; conditions are factors with levels, with full factorial and one-factor-at-a-time first; replicates, plate counts and totals come from template rules before confirm, and power analysis waits for 020; ELISA first, then compound screen and dose-response, Dual-Glo, pNPP, with plasmid assembly after the workflow creator (018).
- **Dilution optimizer, 016:** `transfers.optimize_dilution` decides per compound and point whether the source plate works or an intermediate dilution is needed, and packs all compounds into the fewest intermediate plates and wells, within the DMSO limit and the plate's dead and maximum volume, optimizing accuracy, then plates, then wells; its result is drafted as intermediate plate maps and transfer plans. It is the first of the lab calculators (0024).

## 018 Workflow creator (W1 to W12, all as recommended)

Locked 2026-09-29. Built on echo650-twin's Runbook model.

- **Round 1 (018-W1 to W6):** a workflow is a design for one work unit (one assay plate and what happens to it), with shared plates marked; plate count and units at once are run settings. Code builds the draft from confirmed SOPs, plate maps and transfer plans, including intermediate dilution plates from 016's optimizer; the agent only picks joins (from ranked `workflows.join_options`) and holds. One step per SOP step, with SOPs drawn as nodes you open; robot moves are derived, not drawn. Connections are labware flow, wait-for and timing windows; no cycles and no run-time branches (a data decision ends the workflow and a set starts the next). Steps list candidate instruments from the workcell and standalone instruments; orchestration across them is 019's. A typed schedule request is the contract with 019; 018 shows only an unlimited-resource timeline, "not a schedule".
- **Round 2 (018-W7 to W12):** durations carry their source (measured, simulated, transfer plan, SOP, default); handling rules come from planned contents, SOP windows and lab memory, each with its source, and agents can research missing rules as proposals with citations; holds are steps with conditions, and working hours are the scheduler's calendar; standalone workflows for routines, with recurrence on the schedule request; a run's checklist comes from the workflow's steps; several experiments on one day are combined by the scheduler. [Plan 018](../plans/018-workflow-creator.md)

## 019 Scheduler and orchestrator (S1 to S18)

Locked 2026-09-29; all as recommended except S12 (B). Built on echo650-twin's deterministic dispatch and exposure kernel, which had no solver, people, calendars or hand carrying.

- **Round 1 (019-S1 to S6):** two levels in one engine: a lab orchestrator across standalone instruments, people and the workcell, and the ported echo650 kernel planning each workcell segment exactly; we plan and simulate FlexPod segments and Cellario executes them; plates move between places as derived carries with travel times, counted as time out of controlled conditions; people are resources with hours, absences and training; person time is split from walk-away time; the engine is echo650's slack-first dispatch plus minimum and maximum waits, people and calendars, to be improved or overhauled where it doesn't fit, with a solver interface for later.
- **Round 2 (019-S7 to S12):** the app owns calendars and bookings, with a calendar page where people book instruments and actions directly and an iCal feed out; a schedule is a design a person confirms (tentative bookings until then); confirmed bookings stay put and moving others' work needs their confirmation; agents use options, what-ifs and explanations and never set times; a person can loosen a hard rule for one schedule with a reason; people are the only transporters for now (S12 B), AMRs later.
- **Round 3 (019-S13 to S18):** durations carry a spread by source, a person can state an expected duration, repeatable actions learn their mean and standard deviation from Cellario, instrument and robot logs, and per-action timing models fitted from instrument logs predict worklists and calibrate the twins, and hard rules must hold in fixed stress cases; live runs follow actual times and re-plan only what hasn't started, small own-work re-plans applying automatically; Gantt lanes by instrument, person and plate with simulation playback; prep lists and loading cards; a fixed objective order (rules, science margin, priorities, finish, out-of-hours work, changeovers) that people meet as three or four option cards and one "what matters most" question, with the agent recommending; split 019a to 019e. [Plan 019](../plans/019-scheduler-and-orchestrator.md)

## 020 Analysis (A1 to A18, all as recommended)

Locked 2026-09-29. Wali asked whether scientists should also get Plotly for control over their graphs; A7 answered it with one engine and a format panel.

- **Round 1 (020-A1 to A6):** an analysis template is a series of steps against plate-map roles and groups; an analysis applies it to runs, is drafted and confirmed, and its results are versioned and linked to their files. Every statistical method is a vetted entry in a catalog in the science service, and derived columns use 012's expression language (a sandboxed Python step may come later). An import format per reader export turns files into tidy measurements, with agent-drafted column mappings for unknown files. Graphs are Vega-Lite specs. Exploration covers results across runs, experiments, campaigns and sets in linked views, and selections can become sets. An analysis drafts itself when a run's data arrives and a person confirms it.
- **Round 2 (020-A7 to A12):** one chart engine (Vega-Lite) with a Prism-style format panel, and exports (CSV, Excel, Python notebook with Plotly or matplotlib, Prism .pzfx) instead of Plotly inside the app. Measurements and results in Postgres; Parquet and DuckDB wait for per-cell imaging. Exclusions need a reason, and outlier tests only propose. The first catalog covers the five seed assays, checked against reference results (NIST, R drc). Hit calls and verdicts are computed (a prediction is supported only if its whole confidence interval passes). Repeats are fitted per run and then summarized, never extrapolated.
- **Round 3 (020-A13 to A18):** agents can do everything but confirm; questions about data become editable view specs, not SQL; `analysis.power` uses the template's own history for the designer; control charts per template raise drift notes and lab memory proposals; an analysis page, an explore page and a templates page; split 020a to 020g. [Plan 020](../plans/020-analysis.md)
