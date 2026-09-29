# 018: Workflow creator

- Status: in planning. Round 1 (W1 to W6) asked 2026-09-29. Don't build from this yet.
- Depends on: 008 (capabilities, instruments, manual stations, workcells, `instruments.find_capable`), 009 (handling rules on products), 010 (effective handling rules from well contents, storage locations), 012 (digital SOPs: typed steps, per-step inputs and outputs, timing windows), 013 (experiments, runs, sets), 014 (plate maps: plate count and planned contents), 016 (transfer plans: instrument steps, deck layouts, time estimates), 017 (the designer drafts the whole design)
- Feeds: 019 (the scheduler schedules a confirmed workflow), 013 (a run follows a workflow), 015 (twins simulate workflow steps), 021 (notebook timeline), 022 (the gateway and Cellario hand-off run the same steps)

## What this plan delivers

"How the day (or the week) goes" for one experiment, as a checked graph the scheduler can plan:

- **Workflows:** the chain of steps from several SOPs and transfer plans, in the right order, acting on named plates, tubes and reservoirs, with the waits and timing windows between them. The compound screen is one workflow across three SOPs and three days: make assay-ready plates on the Echo, seed cells with the Mantis, incubate 48 h in the Cytomat, add CellTiter-Glo, read on the Spark.
- **Chaining SOPs:** 012 kept each SOP to one procedure with clear inputs and outputs per step (G8). The workflow connects them: the plate that comes out of the compound transfer is the plate the seeding SOP fills.
- **Labware paths:** every plate, tube and reservoir is followed from where it starts to where it ends (stored, discarded, handed to the next experiment), so nothing is left on a deck by accident.
- **What binds the scheduler:** timing windows from SOPs, handling rules from what is in each plate (000 idea 1.7), which capabilities or instruments each step needs, and duration estimates with their source.
- **Views:** a graph of steps and labware paths, and a timeline that assumes unlimited instruments, clearly labelled "not a schedule". The real, resource-aware Gantt comes from the scheduler (019).
- **The interface to the scheduler:** a typed schedule request built from a confirmed workflow plus run settings (how many plates, start time), which 019 turns into a schedule. Scheduling itself is out of scope here.

## Starting point

- **echo650-twin's Runbook work** (`docs/architecture/WORKFLOW_GRAPH_DESIGN_PLAN.md`, `GENERAL_SCHEDULER_PRODUCT_PLAN.md`, `RUNBOOK_CONTRACTS.md`, read at commit 59a7a6a). It already worked out most of the graph model, and the lessons carry over:
  - The graph describes **one work unit** (for example, one assay plate and what happens to it). How many units, which ones share a source plate, and how many run at once are run settings, not copies of nodes.
  - **One labware node type.** Source, destination and intermediate are what a step's input calls the plate, not a property of the plate. A plate that is a destination in one step is the source in the next.
  - Three kinds of connection: **labware flow** (this plate, in the state the last step left it), **wait for** (all listed steps finished, finish-to-start) and resources, which are not drawn as plates.
  - **Every labware path ends** at an explicit end (store at 4 °C, return, discard), and the run's end-state map shows where each thing should be.
  - **Intent first, binding later:** a step can exist as "Spin" or "Transfer" before an instrument or method is chosen. The instrument's method (here: the transfer plan and its worklist) owns wells, volumes and tips; the workflow never duplicates them.
  - **Validation in layers** (shape, meaning, bindings, resources, timing, biology), each with a plain message pointing at the step to fix. A draft saves with gaps; only the executable check blocks.
  - Its correction is a warning too: its first plan let one Echo example shape the whole model. Here the same core must handle an ELISA (manual and washer), a compound screen (Echo, Mantis, Cytomat, reader, three days) and plasmid assembly (tubes, thermocycler, overnight culture) from the start.
  - Transport (robot moves, delid, relid) is derived by the scheduler and twins, shown as an expandable layer, not drawn by hand.
- 012: typed steps (G2) with capabilities, per-step inputs and outputs (G8 note), timing windows as typed constraints with their source.
- 013: a run pins the design version it follows (E2, E8); the run view is a checklist (E7).
- 014/016/017: plate maps give plate count and planned contents; transfer plans give instrument steps with deck layouts and estimated time; the designer drafts the whole design in one ask (P1: separate documents, each confirmed).
- 008: capabilities are code contracts; manual stations are instruments (I6); workcells are confirmed designs (I8, I9).
- `seed/assays.yaml`: the plasmid assembly template is a chain of SOPs rather than a plate; 017 D7 left it for this plan.

## Proposed model (assuming the recommended answers)

| Layer | Record | Holds |
| --- | --- | --- |
| Kind | **Workflow template** (`wft_`, `WFT-0001`), if W1 is A | A reusable workflow for an assay or a routine ("compound screen, 3 days", "HEK293 passaging, twice a week"), saved from a workflow or drafted by the agent |
| Instance | **Workflow** (`wf_`, `WF-0001`) | For one experiment (or standalone): the work-unit graph (labware nodes, steps, connections, ends), links to the SOP versions, plate maps and transfer plans it came from, candidate instruments per step, timing windows and handling rules with sources, duration estimates, readiness, out-of-date flag (P6) |
| Part | **Labware node** | A plate, tube, reservoir or trough in the work unit: type (or requirement), planned contents (from the plate map), lid or seal state, one per unit or shared across units |
| Part | **Step** | Intent (a 012 action or an instrument session from a transfer plan), the SOP step it came from, inputs and outputs, capability and candidate instruments, parameters owned by the SOP or transfer plan (linked, not copied), duration estimate and its source |
| Part | **Connection** | Labware flow (output of one step to input of the next), wait-for, timing window (min, max, target with tolerance) with its source and hard or soft |
| Part | **End** | Where a labware path finishes: store (location and condition), return, discard, or hand over to another workflow |
| Contract | **Schedule request** | A confirmed workflow version plus run settings (units, shared roles, earliest start, deadline, how many units at once), validated, for 019 |

Pure logic in `packages/domain/workflows`: graph checks (acyclic, every input connected, every path ends, one state per plate at a time), expansion of one unit to N units with shared roles, timing arithmetic (can the windows all be met ignoring resources, critical path, earliest and latest start per step), merging handling rules along a labware path. All unit tested.

## Operations (first cut, adjusted once decisions are made)

| Operation | Agents |
| --- | --- |
| `workflows.draft` (from an experiment's confirmed design, a template, or a description) | direct |
| `workflows.add_step`, `workflows.connect`, `workflows.set_window`, `workflows.set_end`, `workflows.bind_step` | direct on drafts |
| `workflows.check` (every layer of validation, plain messages) | read |
| `workflows.timeline` (unlimited-resource timeline and critical path), `workflows.candidates` (instruments per step), `workflows.constraints` (every timing window and handling rule with its source) | read |
| `workflows.confirm` | people, or proposed |
| `workflows.schedule_request` (build and validate the request for 019) | read |
| `workflow_templates.draft`, `workflow_templates.save_from`, `workflow_templates.confirm` | direct on drafts, confirm people or proposed |
| `workflows.get`, `workflows.search`, `workflows.where_used` | read |

## Screens

- **Workflow page:** the graph, grouped by SOP, with labware paths as coloured threads you can follow; one inspector for the selected step; the readiness panel; the agent beside it.
- **Timeline:** steps on a time axis with waits and windows drawn, marked "not a schedule, assumes every instrument is free".
- **End-state list:** each plate and tube with where it ends and in what condition.

---

## Round 1 questions (as asked): what a workflow is

Recommended option starred. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| W1 | What is a workflow, next to SOPs, experiments and runs? | A) A design document for one work unit (one assay plate and everything that happens to it, with shared plates such as the compound source marked shared). An experiment's workflow is confirmed like any design; each run pins a confirmed version; how many units and how many at once are run settings. Reusable workflow templates exist for assays and routines · B) A list of SOPs in order for an experiment, no graph · C) A fully expanded plan with every plate explicit, which is also the schedule | ★ **A.** It is echo650-twin's hard-won model: one graph per unit keeps the design readable whether you run 2 plates or 20, and changing the plate count doesn't change the design. B can't say which plate goes where or how long it may wait. C mixes design and schedule, so every change of plate count or start time is a new design. |
| W2 | Where does the first draft come from? | A) Code builds it from the confirmed inputs: each pinned SOP's steps become steps, plate maps give the labware and the unit count, transfer plans replace their transfer steps with instrument sessions. Intermediate dilution plates that 016's dilution optimizer adds (Wali's current lab app does this: it computes an intermediate plate so a dilution hits the right concentration, and the workflow builds that plate and its transfers) arrive as their own plate map and transfer plan, and code turns them into labware and steps, wired before the transfer that draws from them, with no hand-drawn joins. The agent does what code can't: decide how SOPs chain (which output plate feeds which input), add holds between them (Cytomat overnight), and settle ambiguities, all through operations, marked assumed. A person confirms · B) The agent drafts the whole graph from the SOP text · C) A person draws it on a canvas | ★ **A.** Most of the graph is already in confirmed documents, so code can lay it out exactly; the agent's judgement is needed only at the joins. B re-guesses what is already known; C is the click-heavy form you want to avoid (a person can still edit the graph). |
| W3 | How fine are the steps? | A) One step per SOP step (a "wash 3 times" stays one step with its repeat inside), grouped by SOP on the page; one step per instrument session from a transfer plan; robot moves, delid and relid are not drawn but derived by the scheduler and twins and shown as an expandable layer · B) One step per SOP (coarse blocks) · C) One step per physical action, moves included | ★ **A.** Timing windows sit between SOP steps ("read within 10 min of stop"), so SOP blocks are too coarse; drawing every move by hand is what echo650-twin learned not to do. |
| W4 | What can connect steps? | A) Labware flow (this plate, in the state the last step left it), wait-for (all listed steps finished), and timing windows on connections (min, max, target with tolerance, each with its source and hard or soft). No cycles; fixed repeats ("feed every 24 h for 3 days") are expanded. No branches decided at run time: a decision on data (hits, the right colony, a failed QC) ends the workflow, and a follow-up starts from a set (013 E10) · B) Also run-time branches and loops (if QC fails, re-read) · C) A straight sequence only | ★ **A.** Run-time branches need the scheduler to plan both paths and the gateway to decide, which neither can do yet; echo650-twin deferred them for the same reason. Sets already carry "which ones move on" between experiments. C can't express the ELISA plate and the standards being prepared in parallel. |
| W5 | How are steps tied to instruments? | A) A step names its capability (from the SOP) and code lists the candidate instruments for it, given the labware and the active workcell (`instruments.find_capable`). A step is pinned to one instrument only when something fixes it: a transfer plan's worklist (the Echo), the SOP, or a person. The scheduler picks among the candidates · B) Every step is bound to one instrument in the workflow · C) No instruments in the workflow; the scheduler works it all out | ★ **A.** Keeping candidates lets the scheduler use the second reader when the first is busy, while steps with a worklist stay on the instrument the worklist was written for. B fixes choices too early; C hides from you which instruments a workflow can use until it is scheduled. |
| W6 | What is the interface to the scheduler (019)? | A) A schedule request, defined here and checked by code: the confirmed workflow version plus run settings (units, which plates are shared, earliest start, deadline, units at once). It lists steps with duration estimates and their source, what each needs (capability, candidates, a person for manual steps), wait-fors, timing windows (hard or soft, with source), each plate's handling rules from its planned contents, and the end states. 019 returns a schedule that refers to workflow steps per unit. 018 also shows an unlimited-resource timeline labelled "not a schedule" · B) The scheduler reads SOPs, plate maps and experiments itself; no contract · C) 018 also schedules simply, on one instrument at a time | ★ **A.** A typed contract lets 019 be built and tested on its own, and lets Cellario or another scheduler take the same request later (022). The resource-free timeline catches impossible windows before the scheduler exists. C duplicates 019. |

## Round 2 topics (to ask next)

- Where durations come from before anything is measured (SOP times, transfer plan estimates, defaults per action, lab memory from past runs, twin simulation), and how they are marked.
- Handling rules at design time: the plates don't exist yet, so rules come from planned contents (plate maps) and SOPs; how they show, and what a person can override.
- Holds between steps and days: storage as a step or an end, overnight and weekend gaps, working hours for manual steps (scheduler's or workflow's).
- Standalone and recurring workflows (cell passaging, library reformatting) without an experiment, and workflow templates.
- How a run (013) records against a workflow: the checklist from workflow steps rather than SOP steps.
- Several experiments on one day: combined by the scheduler, or a workflow that spans experiments.

## Proposed split (after decisions)

- **018a:** schemas, `packages/domain/workflows` (checks, unit expansion, timing arithmetic), operations, schedule request contract.
- **018b:** drafting from a confirmed design (SOP steps, plate maps, transfer plans), agent joins, candidates, constraints with sources.
- **018c:** workflow page (graph, labware paths, timeline, end states), templates, skill.
