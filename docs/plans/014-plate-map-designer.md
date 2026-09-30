# 014: Plate map designer

- Status: accepted. Round 1 (P1 to P6, shared by 014, 016 and 017) and round 2 (M1 to M6) accepted by Wali 2026-09-29, all as recommended, with the note on M1. Ready to build after 013a and 010c.
- Depends on: 004c/004d (draft-and-confirm, Review), 007 (labware types, well geometry), 009 (products, lots, liquid types), 010 (entities, samples, sets of compounds, well composition model, mixing math), 012 (SOP layout requirements), 013 (experiments, conditions and controls, sets)
- Feeds: 016 (a transfer plan makes the plates a plate map describes), 017 (the experiment designer drafts plate maps), 019 (plate count drives scheduling), 020 (analysis reads which well is what)

## What this plan delivers

The answer to "what goes in which well", for one experiment or for a stand-alone job (a library reformat, a standard plate):

- **Layout templates:** the lab's reusable patterns ("IL-6 ELISA 96: standards columns 1 and 2, blank H1:H2, samples in duplicate", "384 compound screen: DMSO columns 1 and 2, staurosporine 23 and 24, compounds 3 to 22"). They say which roles go where and how, never which sample.
- **Plate maps:** a layout applied to real subjects: these 40 supernatants, these 320 compounds at 10 µM, this 7-point standard series. The map spreads them across as many plates as needed, repeats per-plate controls, and states every well's intended contents with amounts or final concentrations.
- **A visual editor:** the plate drawn to scale from 007, wells tinted by role and shaded by concentration, select-and-paint for small fixes, and the agent beside it for everything else ("move the blanks to H11:H12", "randomize samples within each plate", "add a third replicate").
- **Readiness:** controls on every plate, replicates met, SOP layout requirements met (012), volumes within the well's working range, DMSO below the SOP's limit, edge wells used or avoided as the layout says.

## Starting point

- `seed/assays.yaml` already writes layouts as lab conventions in words ("columns 1-2 (DMSO)", "10-point 3-fold from 10 uM, duplicate; 16 compounds per plate"). They become the first layout templates.
- 012 left plate layout requirements in an SOP as a spec (8-point standard in duplicate, blanks, control columns), not a well map; this plan turns that spec into wells and checks the map against it.
- 013 lists conditions and controls per experiment in lab terms and left well positions to this plan. Sets (E10) are the subjects a follow-up experiment receives.
- 010 V3 gives every well a full composition (components with amount and concentration). A plate map's intended contents use the same shape, so planned and actual can be compared well by well.
- 007 L2: wells are named `A1` to `AF48`, row-wise and column-wise ordering lives in `packages/domain/labware`.

## Model

| Layer | Record | Holds |
| --- | --- | --- |
| Kind | **Layout template** (`lyt_`, `LYT-0001`) | Plate format (well count or a labware type), roles (standard, blank, sample, compound, neutral control, positive control, empty, other), a region per role (wells, rows, columns, "everything else"), replicate scheme (side by side, down a column, on another plate), placement strategy (in order, randomized within plate, balanced across plates) with its seed, per-plate controls, edge policy (use, leave empty, fill with buffer), what fills leftover wells, series shape (points, direction), analysis groups (M6) |
| Instance | **Plate map** (`pmp_`, `PMP-0001`) | Experiment (optional), layout it came from, labware type, subjects per role (samples, lots, entities, a set, series), the generated set of plates (1 to n) and their wells, hand overrides, strategy seeds, out-of-date flag when something upstream changed (P6) |
| Part | **Series** | Subject, top concentration, factor, points, direction, replicates (M2); expands into wells |
| Per-well | **Well plan** | Role, intended components with amount or final concentration and volume (010's composition shape, P2), replicate and series index, analysis group labels ("compound CMP-0003, point 4 of 10"), whether it is an override |

Pure logic in `packages/domain/platemap`: region parsing ("A1:H2", "columns 23-24"), fill orders, replicate placement, series generation (n-point, x-fold, from a top concentration), paging across plates with per-plate controls, every placement strategy with a stored seed (in order, randomized within plate, balanced across plates, edge exclusion), and overrides that survive regeneration. All unit tested. The same inputs and seed always give the same map.

## Operations

| Operation | Agents |
| --- | --- |
| `layouts.draft` (from a description or from scratch), `layouts.save_from_map` (any plate map becomes a template), `layouts.update` | direct on drafts, proposed on active |
| `layouts.confirm` | people, or proposed |
| `platemaps.draft` (from an experiment, a layout and subjects, or a description) | direct |
| `platemaps.assign` (put subjects, controls or a series into a region), `platemaps.override` (wells), `platemaps.set_strategy`, `platemaps.regenerate` | direct on drafts |
| `platemaps.confirm` | people, or proposed |
| `platemaps.get`, `platemaps.wells` (per-well plan, for rendering and for 016 and 020), `platemaps.check` (readiness) | read |
| `platemaps.export` (CSV of well and contents, for instruments that take a plate map file and for people) | read |

## Screens

- **Plate map page:** one plate at a time with a strip of all plates, legend by role, concentration shading, a well inspector (what, how much, why it is there), readiness panel, agent panel. Selecting wells and choosing a role or a subject from a short list is the only form.
- **Layout library:** thumbnails of the lab's layouts with where they are used; "new layout" and "save as layout" both open a draft with the agent beside it.

---

## Round 1 answers

Wali chose A for P1 to P6 on 2026-09-29.

## Round 1 questions (as asked): how the three designers fit together (shared by 014, 016, 017)

Recommended option in bold. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| P1 | Is a design one document or several? | A) Three linked documents, each with its own draft and confirm: the experiment (013, filled by the designer 017), its plate maps (014) and its transfer plans (016). One ask drafts all of them together and Review shows them as one design with tabs, but each confirms on its own · B) One big design document with layout and transfer sections · C) Plate maps and transfers are sections inside the experiment record | **A.** Plate maps and transfer plans are also needed without an experiment (reformatting a compound library, making assay-ready plates for stock, cherry-picking hits), and a transfer plan is often confirmed later than the design, on the day the tubes are known. Separate readiness per document also keeps each review short. |
| P2 | What does a plate map say about a well? | A) The intended contents only: what, the role, and the final amount or concentration and volume ("CMP-0003, 1.1 µM, 25 µL, 0.1% DMSO"). How to get there (direct Echo dispense, serial dilution, an intermediate plate) is the transfer plan's job · B) The map also holds the dilution and pipetting steps · C) Labels only (role and sample name); concentrations live in the SOP | **A.** The science stays apart from the mechanics, so one map runs on the Echo or on the STAR unchanged, and the planned composition uses 010's well model, so planned and actual compare well by well. C can't compute a dose-response or check DMSO. |
| P3 | Are layouts reusable on their own? | A) Two levels: a layout template is the lab's reusable pattern (roles by region, replicates, controls per plate, fill order), and a plate map applies one to real subjects across as many plates as needed · B) Plate maps only; reuse by copying an old map · C) Layouts only; wells are computed whenever needed, nothing stored | **A.** The layouts in `assays.yaml` are exactly templates, and an agent that starts from the lab's confirmed layout makes far fewer odd choices. C loses hand fixes and the record of what the plate actually was. |
| P4 | How is a plate map stored and edited? | A) Both the rules that generated it (layout, subjects, series, seed) and the resulting explicit wells. Hand edits (painting wells or asking the agent) are kept as overrides, marked as such, and survive regeneration when the sample count changes · B) Explicit wells only; any change to the inputs means redoing the map · C) Rules only, no hand edits | **A.** Same idea as 007 L2 (a grid plus exceptions). The sample count changes all the time before a run; B throws away the person's fixes each time, C can't express "skip B7, it's a cracked well". |
| P5 | Who picks the physical tubes and plates? | A) The plate map names what goes in (samples, lots, entities, a set, a series); the transfer plan (016) picks the containers to draw from (which tube, which source plate well, enough volume after dead volume) and the new plates to make · B) The plate map picks containers too | **A.** The map is known when the design is confirmed; which tube has enough left is known on the day, and 010's soft reservations (V8) sit on the transfer plan. It also lets one map be run twice (two biological repeats) from different tubes. |
| P6 | What happens downstream when something upstream changes? (sample count, SOP version, layout) | A) Drafts downstream redraft automatically. Confirmed downstream documents are never changed silently: they are marked "out of date" with what changed upstream and a one-click redraft, which then goes through confirm again · B) Changes cascade into confirmed documents automatically and they need re-confirming · C) Nothing is linked; a person redoes each document | **A.** Same rule as 012 and 013 (a new SOP version flags experiments still in planning): a confirmation means a person saw these exact values (004c C3). |

## Round 2 answers

Wali chose A for M1 to M6 on 2026-09-29, with this note:

- **M1, all strategies and plate map templates.** Wali wants every placement option available, so 014 ships all of them: in order (row-wise or column-wise), randomized within each plate, balanced across plates (blocking, Latin square style spreading of replicates and conditions), and edge wells left out or filled with buffer. Every strategy stores its seed and settings so the map can be rebuilt exactly. The layout says which is the default; the person or the agent can switch. Layout templates (P3) are something the lab creates freely: a person or the agent drafts one from scratch ("our ELISA 96: standards columns 1 and 2, blanks H1:H2, samples in duplicate") or saves an existing plate map as a template, and confirms it like any design. Seed templates come from `assays.yaml`.

## Round 2 questions (as asked): plate maps in detail

Recommended option in bold. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| M1 | How are subjects placed in wells? | A) In order (row-wise or column-wise) by default; the layout can also ask for randomized within each plate (the seed is stored, so the map can be rebuilt exactly) and for edge wells to be left out or filled with buffer · B) In order only · C) Also balanced designs across plates (blocking, Latin squares) now | **A.** Randomizing and avoiding edges are the two things labs actually do against plate effects; stored seeds keep them reproducible. Balanced block designs belong with design of experiments (017) and can be added as another strategy later. |
| M2 | Is a dilution series one thing in the map? | A) Yes: a series (what, top concentration, factor, number of points, direction, replicates) is one object the map expands into wells. The transfer plan reads it to choose serial dilution or direct dispense, and analysis reads it to fit a curve per subject · B) No, just wells that happen to have concentrations | **A.** "10-point 3-fold from 10 µM in duplicate" is how people think and how the agent will be asked; with B every consumer has to reverse-engineer the series from numbers. |
| M3 | What happens when the subjects need more than one plate? | A) One plate map is a set of plates from one layout: per-plate controls and standards repeat on every plate, subjects page across plates in order, and a layout says what fills the leftover wells on the last plate (empty, neutral control, buffer). Plates are numbered 1 to n in the map and get real containers in 016 · B) One plate map per plate, linked by the experiment | **A.** 320 compounds on 384-well plates is one decision, not two; Z' and normalization need controls on every plate, which A guarantees. |
| M4 | Is a layout tied to one plate format? | A) Yes: a layout is written for one format (96, 384, 1536). Moving a design to another format is an agent redraft into a new layout, which a person confirms. Reformatting physical plates (4 × 96 into 384) is a transfer plan (016) using 010's mappings · B) Layouts are format-free and scale themselves between formats | **A.** Control positions, edge policy and replicate spacing don't scale mechanically (columns 23 and 24 have no 96-well equivalent), and a silent conversion is exactly the kind of assumption we mark. |
| M5 | How much editing happens in the UI? | A) Select wells (click, drag, a row or column header) and pick a role or subject from a short list; drag a selection to move it; anything bigger goes through the agent ("third replicate", "swap standards to the right") · B) Agent only; the map is read-only on screen · C) A full spreadsheet-style editor | **A.** Small fixes are faster by hand than by typing a request, and the rest matches "no 100-option forms". Every hand edit becomes an override (P4). |
| M6 | Does the map say how wells are grouped for analysis? | A) Yes: each well carries its role, subject, replicate and series point, and the layout declares the groups analysis uses (a curve per compound, the mean of replicates, Z' per plate from its controls). 020 reads these rather than guessing · B) Analysis (020) works out the groups itself | **A.** The person who designed the plate knows what belongs together; writing it down at design time is what lets an agent analyse a plate without asking. |

## Defaults I'm assuming (say if any is wrong)

- Roles are a fixed vocabulary in code (standard, blank, sample, compound, neutral control, positive control, negative control, reference, buffer, empty) with a free label for anything lab-specific.
- A plate map can be made without an experiment (stand-alone jobs, P1); it then names its purpose instead.
- Plates in a map are numbered 1 to n; real barcodes arrive when the transfer plan (016) makes the containers.
- Exports to instrument software that takes a plate map file (Mantis, PreciseDrop) go through 016's worklist format records, so there is one writer per format.
- Readiness checks: every plate has its controls, replicates are met, the SOP's layout requirements are met, volumes are within the well's working range, solvent is under the SOP's limit, overrides that no longer apply after regeneration are listed.

## Proposed split

- **014a:** schemas, `packages/domain/platemap` with every placement strategy, operations, seed layouts from `assays.yaml`. Built (014a-1): `packages/domain/src/platemap.ts` with regions, series, replicate cells, paging with per-plate controls, the three strategies with seeds, edges, leftovers and overrides. Built (014a-2): the layout record, `layouts.draft`, the `layouts.preview` calculator and five seed layouts (ADR 0043). Built (014a-3): the plate map record, `platemaps.draft`, `platemaps.wells`, `platemaps.override` and `platemaps.export`; `platemaps.assign`, `set_strategy` and `regenerate` are covered by `records.update`, since the wells are worked out on every read. `layouts.save_from_map` comes with the editor (014b).
- **014b:** plate map page and editor (select and paint, drag), layout library, agent drafting, readiness checks, skill. Built (014b-1): Layouts and Plate maps pages, the layout's plate with a count to try, and the plate map's plates with key, well details and CSV.
