# Experiments and designers

The scientific frame (013), the designers that fill it (014, 016, 017) the workflows that put a design in order (018) and the scheduler that fits them into the lab's week (019). All six are locked; 013a is built. The goal: "run an IL-6 ELISA on these 40 supernatants" becomes a complete, checked design in one ask, which a person reviews and confirms.

## Campaigns, experiments and runs (plan 013)

[Plan 013](../plans/013-campaigns-and-experiments.md). 013a built: the three records, stages, and SOP versions pinned by version ([ADR 0039](../decisions/0039-designs-pin-inputs.md)); see [campaigns.md](../architecture/campaigns.md). 013b binds each SOP's roles and inputs per experiment, pinned by version, and works the run out from what is pinned (`experiments.calculate`). 013c-1 records runs as a checklist of the pinned SOP steps: tick as planned, type only what differed (a deviation with why), attach data files, finish. 013c-2 concludes an experiment with a verdict per hypothesis and hands hits on as sets. 013d adds the screens: an Experiments menu group, a Next step block on each experiment, and the run as a checklist. Plan 013 is built; reservations come with the transfer designer (016), which knows exact volumes including dead volume (Wali, 2026-09-30).

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

Locked 2026-09-29, all four rounds as recommended: [014](../plans/014-plate-map-designer.md), [016](../plans/016-transfer-designer.md), [017](../plans/017-experiment-designer.md).

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
- **Deterministic tools, so agents compute instead of guessing:** `transfers.options` (every feasible instrument and device with rounding error, liquid class and whether it is verified, dead volume, tips, rough time, ranked), `transfers.dilution_options` (is a concentration reachable within the DMSO limit, directly or through an intermediate plate), `transfers.source_volumes` (what each source needs against stock after reservations) and `transfers.check` (every rule on a finished plan). The UI uses the same operations. They are lab calculators (ADR 0024).
- **Dilution optimizer.** `transfers.optimize_dilution` decides per compound and point whether the source plate works or an intermediate dilution is needed, and packs every compound into the fewest intermediate plates and wells within the DMSO limit and the plate's dead and maximum volume, optimizing accuracy first, then plates, then wells. Its result is drafted as intermediate plate maps and transfer plans, which become workflow steps on their own (018).
- **Worklists from examples.** Each writer is tested against one example file per instrument (Echo pick lists and their transfer and survey reports, an Opentrons Flex protocol, the Hamilton STAR and Vantage import CSVs, Mantis, PreciseDrop) as a golden file. Mocks live in `seed/worklists/` until real exports come from Wali's laptop. Echo and Opentrons writers are code; Hamilton, Mantis and PreciseDrop CSVs are **worklist format** records an agent drafts from an example and a person confirms, so a new lab method is data, not code. Never Venus methods.
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
- **Repeating:** running the same experiment again is another run of the same confirmed workflow with new run settings. For new experiments and routines, any confirmed workflow can be saved as a **workflow template** (roles and capabilities, joins, holds, windows); applying it rebuilds the graph from the new experiment's documents, and assay templates (017) name their workflow template.

## Scheduler and orchestrator (plan 019)

[Plan 019](../plans/019-scheduler-and-orchestrator.md). Locked 2026-09-29; builds after 018a.

- A **schedule** (`SCH-0001`) places every step of one or more workflows on instruments and people, with times, the moves between them and the margin on every timing window and handling rule. The engine drafts it; a person confirms it, which books everything.
- **Two levels, one engine.** The lab orchestrator plans across standalone instruments (Mantis, STAR, washer), benches and people, and treats the workcell as one resource; each stretch a plate spends in the FlexPod is a **workcell segment**, planned in detail by the ported echo650 kernel and run on the day by Cellario.
- **Carries:** a person moving a plate between rooms or instruments is a timed task from the lab's travel table, and counts as time out of controlled conditions. People are the only transporters for now.
- **People** have working hours, absences and training; a person is booked only for set-up, loading and unloading, not an instrument's walk-away time.
- **Calendar:** the app is the source of truth, with a calendar page where people book instruments and actions directly, and an iCal feed out to Outlook or Google.
- **Science first:** hard rules are never broken by the engine; a person may loosen one for one schedule with a reason. Durations carry a spread by source (a person can state one), and hard rules must hold in fixed stress cases. The scheduler **learns**: repeatable actions logged by Cellario, robots and instruments get a measured mean and standard deviation that replace estimates as runs accumulate, with drift flagged. Where a step's time depends on what it does (the order of Echo dispenses, a liquid handler's tips and moves), **timing models** fitted from per-action instrument logs predict it from the worklist, and calibrate the digital twins' simulation.
- **Choosing:** people see three or four option cards (fastest, most margin, keep evenings free) with numbers, and answer one question, "what matters most?"; the agent recommends one and runs what-ifs, but never types times.
- **Views:** Gantt lanes by instrument, person or plate (with each plate's time out against its limit), simulation playback, prep lists and loading cards. During a run it follows actual times and re-plans only what hasn't started.

## Analysis (plan 020)

[Plan 020](../plans/020-analysis.md). Locked 2026-09-29; builds after 013c and 014a.

- **Prism and Spotfire in one.** Each assay has an **analysis template** (`ANT-0001`): import, normalize, fit, quality checks, hit call and graphs, written against the plate map's roles and groups. When a run's reader file is attached, an **analysis** (`ANA-0001`) drafts itself, lands in Review with Z', fit quality and CV as its readiness panel, and a person confirms it.
- **Data in:** an **import format** per reader export (Spark, qTOWER3, Flex absorbance, generic CSV) turns files into measurements matched to the plate map. For a file it doesn't know, the agent drafts a column mapping and a person confirms it.
- **The math:** a catalog of vetted, versioned methods in the science service (normalization, Z', 4PL, 5PL and 3PL with confidence intervals, interpolation, initial rates, Michaelis-Menten, t-tests, ANOVA with Tukey and Dunnett, nonparametric tests), each checked against published reference results. Derived columns use the SOP expression language. No number comes from an agent (ADR 0024).
- **Graphs:** Vega-Lite specs, drawn in the bench console theme, edited through a format panel (axes, log scale, error bars, fit lines, significance marks) by people and agents alike, exported as SVG, PNG or PDF. Data with its spec exports to CSV, Excel, a Python notebook or Prism.
- **Judgement stays with people:** exclusions need a reason and outlier tests only propose. Hit rules produce proposed sets, and a prediction is supported only when its whole confidence interval passes the threshold. Repeats are fitted per run and summarized, and a curve that can't give a value says so ("IC50 > 10 µM").
- **Exploration:** saved **views** (`VIW-0001`) over any runs, experiments, campaigns or sets, with linked heatmaps, scatter, curves and tables. A question in plain language becomes a view spec you can see and edit.
- **Learning:** `analysis.power` suggests replicates to the designer from the template's own history, and control charts per template flag drift by instrument, lot and operator as readiness notes and lab memory proposals.
