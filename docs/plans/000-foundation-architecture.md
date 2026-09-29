# AILaboratory: how to start

Status: accepted by Wali on 2026-09-29. D1 to D7 locked with the recommended options (ADRs 0001 to 0007). Round 1 answers are in section 3.1.

This is plan 000. It sets the architecture, the repo rules, and the order of the smaller plans that follow. Each later plan gets its own file (`docs/plans/NNN-name.md`) with its own decision table, and nothing is built until its decisions are chosen.

---

## 1. The seven ideas everything else hangs on

These are the parts that are expensive to change later, so they are worth getting right before any feature work.

### 1.1 Kind, Instance, State (the backbone of the data model)

Every registry in the app follows the same three layers. Your echo650-twin already does this for instruments (`InstrumentType` → `InstrumentInstance` → live state in `docs/architecture/DATA_MODEL.md`); here it becomes the rule for the whole lab.

| Registry | Kind (reusable definition) | Instance (a real, registered thing) | State (changes over time) |
| --- | --- | --- | --- |
| Instruments | Instrument kind (Hamilton STAR, Opentrons Flex, plate reader model) with specs, capabilities, allowed modules | Registered instrument with serial, location, current configuration (Flex pipettes, modules; STAR fixed deck) | Status, calibration, current deck, twin pose |
| Labware | Labware type (Corning 3570, catalog #, geometry, dead volume, max volume, material) | Barcoded plate / tube / reservoir | Contents per well, sealed, location |
| Reagents | Product or kit (vendor, part #, components, liquid class per instrument kind) | Lot (lot #, expiry, CoA) | Containers holding that lot, remaining volume |
| Biological entities | Entity schema (plasmid, protein, antibody, cell line, compound…) with typed fields | Registered entity (pAB-0012 with its sequence) | Samples / aliquots of it in containers |
| SOPs | SOP template (digital SOP with variables) | SOP version | Executions of it in experiments |

Configurable instruments (Opentrons) and fixed ones (Hamilton) are the same model: the kind declares which slots and modules exist and whether they can change; the instance records what is installed now, with history.

### 1.2 One operation registry, three doors (human = agent)

Every capability in the app is an **operation**: a named, typed, validated function such as `labware.register_type`, `inventory.fill_plate`, `sop.digitize`, `platemap.assign_controls`. Each operation has an input schema, output schema, permission, and a plain-language description.

The same registry is exposed through three doors, generated from the same definitions:

1. **REST/HTTP API** (the UI uses this)
2. **MCP server** (Claude Code, the Claude app, the in-app agent, any other agent)
3. **Skills** (one skill per module that teaches an agent *when and how* to combine operations)

Rule: the UI never mutates data except by calling an operation. That is what guarantees "if a human can do it, the AI can do it", and it is checkable in CI (a test fails if a UI mutation doesn't map to a registered operation).

### 1.3 Draft → Review → Commit (the UX you described)

Designs are **standardized documents**, not forms: `ExperimentDesign`, `PlateMap`, `TransferPlan`, `DigitalSOP`, `Workflow`, `Schedule`, `AnalysisSpec`. Each has a JSON schema and a visual renderer/editor.

- The agent generates a **draft** document in the backend (via operations).
- The UI renders it with a **readiness panel**: what is filled, what is missing, what the agent assumed (marked as assumptions, the same "verified / estimated / unknown" rule echo650-twin uses).
- The user tweaks it visually (drag a control column, change replicates) or asks the agent to change it.
- **Confirm** commits a version. Everything downstream (plate prep, worklists, schedule) derives from committed versions only.

So the app has two modes per page: **explore** (browse registries, read-only, rich views) and **design** (a draft document with the agent beside it). No 100-option wizards; the agent fills the options, the page shows the result.

### 1.4 Everything is a linked, versioned record with an event log

- Stable prefixed IDs (`lwt_…` labware type, `lw_…` labware, `ins_…`, `ent_…`, `smp_…`, `sop_…`, `exp_…`), so links read well and an agent can tell what an ID is.
- Typed references between records (that is the "deep linking": a diluent-volume variable in a digital SOP points at a labware type's dead volume, which is a field on a real record).
- Append-only event log for every change (who: human or which agent, what operation, before/after). This one log powers the audit trail, undo, the lab notebook timeline, and later compliance (21 CFR Part 11 is a later plan, but the log shape supports it from day one).
- Quantities always carry units (`{value: 50, unit: "uL"}`), normalized internally. No bare numbers for volumes, concentrations, times or temperatures.

### 1.5 Operation-first workflows, bound to instruments late

Carried over from echo650-twin's scheduler plan: a digital SOP step says *what* happens (Transfer, Dispense, Seal, Incubate, Spin, Read) using capability contracts. Binding to a specific instrument, liquid class and worklist happens in the transfer designer / workflow creator, based on what the lab actually has. That keeps SOPs portable and lets the scheduler choose instruments.


### 1.6 Lab memory (what makes the agents smart about this lab)

The registries hold the facts that have a schema (what plates exist, what the STAR has on its deck). Lab memory holds everything else a good lab manager knows: conventions ("we block with 2% BSA, not milk"), preferences ("use the Flex for anything under 96 samples"), instrument quirks ("STAR channel 3 drips below 5 uL with the default water class"), lessons from past runs ("edge wells evaporate in the 37 C incubator after 48 h"), and who owns what.

- Each memory is a small record: statement, kind (convention, preference, quirk, lesson, fact), scope (whole lab, campaign, instrument, SOP, person), links to the records it is about, source (who said it, or which experiment or run it came from), and a confidence/verified flag with a review date.
- Agents read it through MCP (`memory.search`, plus a context bundle automatically attached for whatever page or record the user is on), so the agent designing an ELISA sees the lab's ELISA conventions and the quirks of the instruments it is about to pick.
- Agents write it through the same draft/confirm rule: an agent proposes a memory ("I noticed the last three runs on this reader drifted, remember this?"), a person confirms. Memories learned from data (actual step timings, real dead volumes, failure rates) are marked as derived and link to their evidence.
- Search uses the same Postgres full-text plus pgvector setup as the SOP library, filtered by scope and links.


### 1.7 Science-aware scheduling (constraints come from what is in the plate)

The scheduler should know that a plate holds live cells, and act on it without anyone typing the rule into each workflow. Example: a plate has HEK293 cells in it, so it can't be out of the incubator for more than 30 minutes, and any candidate schedule that leaves it out longer is removed or flagged.

- **Constraints live on the science, not on the workflow.** Entity schemas and reagent products carry handling rules: max time out of controlled conditions, temperature range, light sensitivity, max time between two steps, freeze-thaw limits, stability after thaw. A cell line inherits "live cells: 30 min out of incubator" from its kind; an individual line can tighten it.
- **They flow through inventory.** When a plate is filled, it inherits the rules of everything in it, and the strictest one wins. Digital SOPs add step-level rules ("read within 10 min of stop solution", "incubate 60 ± 5 min"). Lab memory can add lab-specific ones ("our HeLa stock tolerates 20 min, not 30").
- **The scheduler treats them as hard constraints.** Candidate schedules that break a rule are pruned; ones that come close show their margin. Every constraint shows where it came from ("30 min limit, from HEK293 cell line kind"), so the user can see why a schedule was rejected and override with a reason if they choose.
- echo650-twin already has most of the engine for this: its exposure kernel (`server/exposure-kernel.ts`) and `docs/architecture/SCHEDULING_RELIABILITY.md` handle controlled/exposed/unknown state, continuous vs cumulative exposure, unknown history and slack. What is new here is deriving those constraints automatically from inventory contents instead of authoring them per workflow.

This touches three plans: 010 inventory (rules on entity schemas and products, inherited by containers), 012 digital SOPs (step timing windows), and 019 scheduler (pruning, margins, explanations).

---

## 2. Proposed architecture

```
apps/
  web/            React + TypeScript UI (explore views, design documents, agent dock, 3D twins)
  api/            TypeScript service: operation registry, REST, MCP server, auth, event log
  science/        Python service: statistics, curve fits, cheminformatics, sequence tools, search/embeddings
  gateway/        Python device gateway (plan 022): runs next to instruments, same capability contracts as the twins
packages/
  schema/         single source of truth for every record, document and operation schema
  domain/         pure domain logic (units, volume math, plate geometry, SOP variable evaluation), no I/O
  twin/           instrument digital twins + simulation engine (ported from echo650-twin)
  scheduler/      scheduling and simulation (ported from echo650-twin, solver added later)
  client/         generated typed API client used by web and by tests
skills/           one agent skill per module (markdown), shipped with the MCP server
docs/
  architecture/   living docs, one per module
  decisions/      ADRs, one per design decision
  plans/          numbered small plans
infra/            docker compose, Postgres, local dev
```

- **Modular monolith**: one API process with clear module boundaries (inventory, labware, instruments, sop, experiments, design, scheduling, analysis, notebook, memory). Modules talk through operations, not through each other's tables. Split into services only if one actually needs to scale separately.
- **Postgres** as the one database: relational tables for identity and links, JSONB for per-kind typed attributes (validated against the kind's schema), full-text search plus pgvector for SOP/literature search.
- **Schema-first**: schemas in `packages/schema` generate TypeScript types, JSON Schema (for MCP tools and agent structured output), OpenAPI, and Python models for the science service.
- **The in-app agent** is just another MCP client of the same server, plus a small set of UI tools (navigate, open draft, highlight a well, show a diff) so it can drive what the user sees.

---

## 3. Decisions to choose now (only the ones that block plan 001)

All seven were accepted as recommended on 2026-09-29.

| # | Decision | Options | Recommendation and why |
| --- | --- | --- | --- |
| D1 | Backend language | A) TypeScript core + Python science service · B) Python core (FastAPI) + TS frontend · C) All TypeScript | **A.** Reuses echo650-twin's twin, scheduler and schema code directly; one type system across API, UI and MCP. Python only where it is clearly better (scipy/statsmodels for the Prism-style analysis, RDKit for compounds, Biopython for plasmids, OR-Tools later). |
| D2 | Database | A) Postgres · B) SQLite like echo650-twin | **A.** Multi-user lab data, concurrent agents, JSONB for flexible kinds, pgvector for literature search. |
| D3 | Frontend | A) React + Vite + a headless component kit · B) Vanilla JS like echo650-twin · C) Next.js | **A.** The design documents (plate maps, Gantt, workflow canvas) are component-heavy; React has the ecosystem. Three.js twins embed as-is inside a React wrapper. Next.js adds server complexity we don't need. |
| D4 | echo650-twin relationship | A) Port twin + scheduler into `packages/twin` and `packages/scheduler` as they are · B) Keep it a separate app and call it over its API · C) Rewrite | **A.** One data model and one clock is the whole point; echo650-twin's own rule is "port twins directly, don't rebuild them". Porting happens in plan 015, not now. |
| D5 | In-app agent runtime | A) Claude via the Claude Agent SDK, talking to our MCP server · B) Model-agnostic via OpenRouter (echo650-twin's current setup) | **A**, with the MCP server as the contract, so any agent can still drive the app. |
| D6 | Tenancy | A) One lab now, but every record carries `org_id`/`lab_id` from day one · B) Single-tenant, add later | **A.** Retrofitting tenancy is painful; carrying the column costs nothing. |
| D7 | Where it runs first | A) Local docker compose, deploy later · B) Cloud from day one | **A.** Faster iteration; cloud is its own small plan once there is something to host. |

### 3.1 Round 1 answers and what they change

| Question | Answer | Consequence |
| --- | --- | --- |
| Users and scale | Wali's personal project, to be folded into the academic lab Wali works in later | Local accounts now; auth kept behind one module so OIDC/SSO can replace it. `org_id`/`lab_id` on every record (D6) makes the move into the lab a data import, not a rewrite. |
| Regulation | None (academic research lab) | No e-signatures or validated audit trail. The event log stays, for undo, provenance and the notebook. |
| Real instrument control | Yes, eventually: Hamilton's Python SDK, Opentrons, Cellario and others | Adds a **device gateway** (Python, runs on the lab network next to instruments) that implements the same capability contracts as the twins, so simulate and run share one interface. Cellario is treated as an external scheduler we can hand a workflow to, not only a device. Capability contracts in plan 008 must be designed so they can lower to these SDKs. |
| Existing systems | None; start fresh with real seed data and templates | A dedicated seed-lab plan (006) builds a realistic lab: real labware catalog items, real instrument models, real reagents/kits, public SOPs, and ELISA/compound-screen templates, used by tests and demos end to end. |
| Who builds it | Wali plus agents | Rules and skills in the repo carry the conventions; every module needs a skill and a living doc, since agents are the main developers. |
| Where it runs | Wali's PC now, an internal Docker cluster later | Everything runs in containers from day one; `docker compose up` is the dev entry point, and dev must work on Windows (echo650-twin's AGENTS.md notes PowerShell use, so Windows is assumed). |

Decisions deferred to their own plans (not needed yet): SOP variable expression language, barcode format, plate-map document shape, scheduler solver, analysis charting library, auth provider, compliance level.

---

## 4. Repo rules (draft for `CLAUDE.md` / `AGENTS.md`)

Carried from echo650-twin where it worked, plus rules for the agent-first design.

**Product rules**
1. Greenfield: one current contract and one execution path. No legacy readers, shims or compatibility aliases. Reject unsupported input with a clear message.
2. Every capability is an operation in the registry, exposed via REST and MCP, with a skill that explains it. No UI-only features.
3. Designs are schema'd documents: agent drafts, user reviews and confirms, downstream work uses committed versions only.
4. Kind / Instance / State stays separate in every registry.
5. Every quantity has a unit. Every ID is prefixed and typed. No free-text `options` blobs for important parameters.
6. Mark what is assumed: agent-filled values, estimates and unknowns are labeled in data and in the UI.
7. Plain lab language in the UI; IDs, schema names and internals live in an expandable technical detail.

**Engineering rules**
1. Schemas change first, in `packages/schema`; code is generated from them. CI fails if generated code is stale.
2. Domain logic (volume math, plate geometry, variable evaluation) is pure and unit-tested in `packages/domain`.
3. Each module owns its tables; other modules go through operations.
4. Every operation has tests for valid input, invalid input, and permission.
5. Small PRs, one plan step each, CI green before review. Branch per plan step.
6. Seed data lives in `seed/` (the test SOP set, common labware, a demo lab) so every agent and developer starts from the same lab.

**Docs rules**
1. One living doc per module in `docs/architecture/`, updated in the same PR as the code.
2. Every design decision is an ADR in `docs/decisions/` (context, options, choice, consequence).
3. Plans are numbered, small, and list their decisions up front.
4. No per-ticket handoff or verification files. (echo650-twin accumulated DT01 to DT28 handoff and verification docs; that history belongs in PR descriptions, not the tree.)

---

## 5. Plan sequence

Each line is one small plan. Plans 001 to 006 are platform, lab memory and seed data; after that, each registry lands as a thin vertical slice (schema, operations, MCP tools, skill, explore view, one agent-drafted design where relevant).

| Plan | What it delivers | Key decisions it will ask |
| --- | --- | --- |
| 001 Repo skeleton | Monorepo layout, `CLAUDE.md`, CI, lint/format/typecheck, docker compose with Postgres, ADRs for D1 to D7 | Package manager, test runner |
| 002 Core records | IDs, units/quantities, versioning, event log, org/lab scoping, auth stub | Unit library, versioning model (row versions vs event sourcing) |
| 003 Operation registry | Define-once operations → REST + MCP + generated client; the "UI mutations go through operations" CI check | Error and permission model |
| 004 Agent shell | Agent dock in the web app, draft/review/confirm framework, readiness panel, UI tools for the agent | Draft storage, how diffs are shown |
| 005 Lab memory | Memory records (conventions, preferences, quirks, lessons), scoped and linked to registry records; MCP search and page context bundles; agent-proposed memories confirmed by a person | Memory kinds and scopes, how context is picked per page, review/expiry |
| 006 Seed lab | Realistic seed dataset and templates (labware, instruments, reagents, public SOPs, demo campaign) loaded by one command, grown as each registry lands | Which instruments and assays are in Wali's lab, SOP sources and licensing |
| 007 Labware library | Labware types with geometry, dead/max volume, catalog data; seed of common plates | Well addressing, geometry model |
| 008 Instrument library | Instrument kinds, registered instruments, configurations (fixed vs modular), capabilities; echo650-twin definitions imported as seed | How much of echo650's definition schema to adopt as-is |
| 009 Reagents and liquids | Products, kits, lots, liquid classes per instrument kind | Liquid class model |
| 010 Inventory | Entity schemas (plasmid, protein, compound, cells…), samples, containers, locations, barcodes, volume ledger, stamping; handling rules on kinds, inherited by containers | Barcode format, volume ledger rules, entity schema builder, handling rule vocabulary |
| 011 SOP and literature library | Upload, parse, full-text + semantic search, test SOP set | Ingestion pipeline, embedding model |
| 012 Digital SOPs | SOP document schema, sections, typed variables and expressions linked to registries, agent digitizer | Expression language |
| 013 Campaigns and experiments | Campaign/experiment records, hypothesis/aims, SOP tagging | Status lifecycle |
| 014 Plate map designer | Plate map document, samples/controls/replicates/layouts, agent-drafted maps | Plate map document shape |
| 015 Twin port | Bring echo650-twin twins into `packages/twin`, bound to the instrument registry | Rendering wrapper |
| 016 Transfer designer | Transfer plans, instrument + liquid class binding, worklist export (Echo, Hamilton, Opentrons first) | Worklist formats, first instruments |
| 017 Experiment designer | Templates (ELISA first, then compound screen, cell assay), custom builder, agent-built designs | Template format |
| 018 Workflow creator | Link SOP steps and experiments into workflows, Gantt views | Workflow graph model |
| 019 Scheduler and orchestrator | Port echo650 scheduler and exposure kernel, science-aware constraint pruning, twin simulation, calendar booking, resources, 3D loading instructions | Solver, calendar integration, override policy |
| 020 Analysis | Templates, statistical methods, charting, agent analysis | Charting library, stats method catalog |
| 021 Lab notebook | Entries built on the event log plus free-form writing, linked to everything | Editor |
| 022 Device gateway | Python gateway on the lab network implementing capability contracts for real hardware (Opentrons, Hamilton Python SDK), plus hand-off of workflows to Cellario | Transport between app and gateway, safety interlocks, which instrument first |

Suggested first end-to-end target once 007 to 014 exist: **one ELISA**, from a digitized SOP to a plate map to a worklist, with the agent drafting each step. It exercises almost every registry at thin depth and proves the draft/confirm UX before the heavier designers.

---

## 6. What was taken from echo650-twin

Checked in `walimmalik/echo650-twin` (read only, commit 59a7a6a):

- Its instrument model (`docs/architecture/DATA_MODEL.md`): InstrumentType / InstrumentInstance / capability contracts / sites / resources. This is the seed for plan 008 and the Kind/Instance/State rule.
- Operation-first runbook authoring (`docs/architecture/GENERAL_SCHEDULER_PRODUCT_PLAN.md`): Transfer → instrument → protocol. Adopted as idea 1.5.
- Readiness checks with a corrective action per stage (`PRODUCT.md`, principle "show the state, not a promise"). Adopted as the readiness panel in idea 1.3.
- "One command interface for UI, scripts and adapters" (`window.labTwin.execute`). Generalized into the operation registry.
- Greenfield no-shim rule and verified/estimated/unknown labeling (`AGENTS.md`). Adopted as repo rules.
- Stack today: plain JS + Three.js frontend, Node/TypeScript server, SQLite (`server/database.ts`), JSON Schema sources in `schemas/source`, agent via OpenRouter (`server/agent-api.ts`). D1 to D5 decide how much of this carries over.
