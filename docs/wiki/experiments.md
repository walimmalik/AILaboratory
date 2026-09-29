# Experiments and designers

The scientific frame (013, locked) and the designers that fill it (014, 016, 017, in planning). The goal: "run an IL-6 ELISA on these 40 supernatants" becomes a complete, checked design in one ask, which a person reviews and confirms.

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

## The designers (in planning)

The plan files are in the project folder while their rounds run and come to `docs/plans` once locked. Rounds 1 and 2 are answered; round 3 (transfers) is asked; round 4 (templates and designer) is not asked yet. Don't build from this section.

### How they fit together (round 1, answered)

- Three linked documents, each with its own draft and confirm: the **experiment** (filled by the designer), its **plate maps**, its **transfer plans**. One ask drafts all three and Review shows them together, but each confirms on its own, because plate maps and transfers are also needed without an experiment (library reformats, cherry-picks) and transfer plans are often confirmed on the day.
- A plate map states **intended contents only** ("CMP-0003, 1.1 µM, 25 µL, 0.1% DMSO"). How to get there is the transfer plan's job, so one map runs on the Echo or the STAR unchanged.
- **Layout templates** are the lab's reusable patterns; **plate maps** apply one to real subjects across as many plates as needed.
- Maps store both the rules that generated them and the explicit wells; hand edits are overrides that survive regeneration.
- The transfer plan picks the physical containers and holds the reservations.
- Upstream changes redraft downstream drafts; confirmed documents are marked "out of date" with a one-click redraft.

### Plate maps (plan 014, round 2 answered)

- Every placement strategy: in order (row-wise or column-wise), randomized within a plate, balanced across plates, and edge wells left out or filled with buffer. Each stores its seed and settings so the map rebuilds exactly.
- The lab makes its own layout templates, from scratch or by saving a plate map as a template. Seed templates come from `seed/assays.yaml`.
- A dilution series ("10-point 3-fold from 10 µM in duplicate") is one object the map expands into wells.
- One plate map spans many plates; per-plate controls repeat on every plate.
- A layout is for one plate format; moving to another format is an agent redraft.
- Small edits by hand (select wells, pick a role or subject); bigger ones through the agent.
- Wells carry analysis groups (curve per compound, Z' per plate), so analysis doesn't guess.

### Transfers (plan 016, round 3 asked)

Recommended, awaiting Wali: code solves the transfers exactly and the agent picks the method per group (direct dispense with backfill, serial dilution, intermediate plates); code lists feasible instruments with their cost and the agent picks with a reason, switchable in one click; Echo CSV and Opentrons protocols first (checked in the Opentrons simulator), then CSV worklists for existing Hamilton methods, Mantis, PreciseDrop and FeliX, never Venus methods; Echo transfer reports imported and matched to the plan; default tip rules; deck layouts drafted and checked against the instrument's configuration.

### Experiment designer (plan 017, not asked yet)

Assay templates tying SOPs, a layout, defaults, readouts, controls, quality criteria and analysis together; a custom builder driven by conversation; a designer that asks only the essentials and fills the rest from conventions and lab memory, marked assumed; feasibility up front (instruments, stock after reservations, liquid classes, plate and tip counts, rough time).

## The lab's assays

These drive the templates and the first end-to-end target (one ELISA): sandwich ELISA (IL-6 DuoSet); single-point compound screen with dose-response follow-up (CellTiter-Glo or HiBiT); enzyme kinetic screen (absorbance or fluorescence, pNPP); Promega Dual-Glo reporter; plasmid assembly (Gibson, Golden Gate) with transformation and miniprep. All six are written in words in `seed/assays.yaml`.
