# Experiments and designers

The scientific frame (013), the designers that fill it (014, 016, 017) and the workflows that put a design in order for the scheduler (018). All five are locked, not yet built. The goal: "run an IL-6 ELISA on these 40 supernatants" becomes a complete, checked design in one ask, which a person reviews and confirms.

## Campaigns, experiments and runs (plan 013)

[Plan 013](../plans/013-campaigns-and-experiments.md). Locked; builds after 012 (013a can start after 010a).

| Level | What it is | Stages |
| --- | --- | --- |
| **Campaign** (`CAM-001`) | A lab project: goal, background, aims with success criteria, owner and people, linked entities and references | proposed, active, paused, completed, stopped |
| **Experiment** (`EXP-0001`) | One question: hypothesis with an optional testable prediction ("DC50 of CMP-0003 below 1 µM"), subjects, pinned SOP versions with their bindings, conditions and controls, readouts, success criteria, plate maps and transfer plans, conclusion | designing, planned, running, analysing, concluded; on hold and cancelled from any stage |
| **Run** (`RUN-0001`) | One execution of the design on a day: operator, planned vs actual per step, lots and containers used, deviations, data files | scheduled, in progress, done, failed, aborted |
| **Set** (`SET-001`) | A named list of entities or samples one experiment hands to the next ("12 hits from EXP-0012") | |

- Stages are separate from record status and fixed, so the scheduler and reservations can rely on them. Moving to planned or concluded is a person's confirm.
- **Planning** confirms the design, binds SOP roles and inputs, and soft-reserves stock. A confirmed design is frozen per version; a change makes a new version that later runs pin. Changes on the day are deviations on the run.
- **Run view is a checklist** (Wali: "users are lazy"). Tick a step to record it as done as planned; "all done as planned" ticks the rest. Type a value only when something differed, which makes it a deviation with a short reason. Scanning is optional; without it the run uses what the plan reserved.
- **Results**: runs attach data files through the file store, linked to the plate and read step. Conclusions per hypothesis (supported, refuted, inconclusive) are drafted by an agent and confirmed by a person. Parsing and statistics are analysis (020).
- **Visibility**: everyone in the lab sees everything; owners and contributors drive "my work" filters.
- A concluded experiment can propose lab memories ("edge wells evaporate at 48 h").

## The designers

Locked 2026-09-29, all four rounds as recommended. The plan files come into `docs/plans` in their own docs PR.

### How they fit together (round 1)

- Three linked documents, each with its own draft and confirm: the **experiment** (filled by the designer), its **plate maps**, its **transfer plans**. One ask drafts all three and Review shows them together, but each confirms on its own, because plate maps and transfers are also needed without an experiment (library reformats, cherry-picks) and transfer plans are often confirmed on the day.
- A plate map states **intended contents only** ("CMP-0003, 1.1 µM, 25 µL, 0.1% DMSO"). How to get there is the transfer plan's job, so one map runs on the Echo or the STAR unchanged.
- **Layout templates** are the lab's reusable patterns; **plate maps** apply one to real subjects across as many plates as needed.
- Maps store both the rules that generated them and the explicit wells; hand edits are overrides that survive regeneration.
- The transfer plan picks the physical containers and holds the reservations.
- Upstream changes redraft downstream drafts; confirmed documents are marked "out of date" with a one-click redraft.

### Plate maps (plan 014)

- Every placement strategy: in order (row-wise or column-wise), randomized within a plate, balanced across plates, and edge wells left out or filled with buffer. Each stores its seed and settings so the map rebuilds exactly.
- The lab makes its own layout templates, from scratch or by saving a plate map as a template. Seed templates come from `seed/assays.yaml`.
- A dilution series ("10-point 3-fold from 10 µM in duplicate") is one object the map expands into wells.
- One plate map spans many plates; per-plate controls repeat on every plate.
- A layout is for one plate format; moving to another format is an agent redraft.
- Small edits by hand (select wells, pick a role or subject); bigger ones through the agent.
- Wells carry analysis groups (curve per compound, Z' per plate), so analysis doesn't guess.

### Transfers (plan 016)

- Code in `packages/domain/transfers` solves targets and sources into exact transfers; the agent picks the method per group (direct dispense with backfill, serial dilution, intermediate plates) and explains it.
- **Deterministic tools, so agents compute instead of guessing:** `transfers.options` (every feasible instrument and device with rounding error, liquid class and whether it is verified, dead volume, tips, rough time, ranked), `transfers.dilution_options` (is a concentration reachable within the DMSO limit, directly or through an intermediate plate), `transfers.source_volumes` (what each source needs against stock after reservations) and `transfers.check` (every rule on a finished plan). The UI uses the same operations.
- **Worklists from real examples.** Before 016a starts, one real file per instrument comes from Wali's laptop (Echo pick list and its reports, an Opentrons protocol, the Hamilton STAR and Vantage import CSV, Mantis, PreciseDrop), each a golden-file test. Echo and Opentrons writers are code; Hamilton, Mantis and PreciseDrop CSVs are **worklist format** records an agent drafts from an example and a person confirms, so a new lab method is data, not code. Never Venus methods.
- Echo transfer reports are imported and matched to the plan; failed wells are flagged and the ledger records what really happened.
- **Tips belong to the protocol.** Each instrument method declares how it handles tips; the plan counts tips and cost from that and warns on clashes. Default tip rules apply only where we write the protocol (Opentrons).
- Deck layouts are drafted per instrument step and checked against the configuration; a missing module becomes a proposed configuration change with its time cost.

### Experiment designer (plan 017)

- An **assay template** is a versioned, confirmed record: the digital SOPs it combines, the layout template, default role bindings, the few essential inputs, controls, readouts, quality criteria (Z' at least 0.5), the analysis plan and the usual next assay.
- The **custom builder** is the agent drafting that same record from a conversation, SOPs and past experiments; any experiment can be saved as a template. No block editor.
- The **designer** asks only the template's essential inputs (ELISA: which samples and their dilution), fills the rest from the template and lab memory, marked assumed, and drafts the experiment, plate maps and transfer plans together.
- Templates name capabilities and roles, not instruments; the designer binds them with 016's tools and says plainly what the lab can't do.
- Conditions are factors with levels. Full factorial and one-factor-at-a-time first; fractional factorial and response-surface designs later through the science service.
- Replicates and control counts come from template rules with reasons; plates, tips, reagent against stock and rough time are totalled before confirm. Power analysis waits for analysis (020).
- Order: ELISA, then compound screen and dose-response, Dual-Glo, pNPP. Plasmid assembly waits for the workflow creator (018).

## The lab's assays

These drive the templates and the first end-to-end target (one ELISA): sandwich ELISA (IL-6 DuoSet); single-point compound screen with dose-response follow-up (CellTiter-Glo or HiBiT); enzyme kinetic screen (absorbance or fluorescence, pNPP); Promega Dual-Glo reporter; plasmid assembly (Gibson, Golden Gate) with transformation and miniprep. All six are written in words in `seed/assays.yaml`.

## Workflows (plan 018)

[Plan 018](../plans/018-workflow-creator.md). Locked 2026-09-29; builds after 012, 014a and 016a.

- A **workflow** (`WF-0001`) is how the day or the week goes for one experiment (or a routine like passaging): the steps of its SOPs and transfer plans in order, acting on named plates, tubes and reservoirs, with waits and timing windows between them.
- It describes **one work unit** (one assay plate and everything that happens to it). Shared plates, such as a compound source, are marked shared. How many units, and how many at once, are run settings, so 2 plates or 20 is the same design.
- **Code drafts it** from confirmed documents: SOP steps become steps, plate maps give labware and plate count, transfer plans become instrument sessions, and intermediate dilution plates appear on their own. The agent chooses how SOPs join (from ranked options) and where plates wait between them.
- On the page each **SOP is a node** you open to see its steps; labware paths run through them; every path ends somewhere explicit (stored, discarded, handed on).
- Steps list **candidate instruments**, in the workcell or standalone; a step is pinned only when a worklist, the SOP or a person fixes it.
- **Timing and science:** durations, timing windows and handling rules (from what the plate map puts in each plate) all show their source. Agents can research a missing rule and propose it with citations.
- The **schedule request** (a confirmed workflow plus run settings) is what the scheduler (019) plans; the workflow page shows only a timeline that assumes every instrument is free, labelled "not a schedule".
- When an experiment has a workflow, the **run checklist** follows its steps, plate by plate.

