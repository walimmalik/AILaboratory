# 012: Digital SOPs

- Status: accepted. Round 2 (G1 to G6) and round 3 (G7 to G11) accepted by Wali 2026-09-29, all as recommended, with the notes under round 3's answers. Ready to build after 011 and 009a.
- Depends on: 011 (library documents and passages), 004c (draft-and-confirm), 007 (labware types, dead volumes), 008 (capabilities, manual stations), 009 (products, recipes, lot-specific fields, liquid types, handling rules), 010 (entities, containers)
- Feeds: 013 (experiments follow confirmed SOP versions), 014 (plate maps meet an SOP's layout requirements), 016 (transfer steps become transfer plans), 017 (assay templates combine SOPs), 018 (workflows link SOP steps), 019 (step timing windows bind the scheduler), 020 (analysis sections), 021 (notebook)

## What this plan delivers

A lab SOP as a structured, versioned design document that the app and agents can compute with:

- **Sections:** overview (purpose, scope, safety), materials (reagents, entities, labware, instruments or capabilities), solutions to prepare, procedure steps, plate layout requirements, analysis, timing rules.
- **Typed steps:** each step is an action (add, transfer, serial dilute, wash, incubate, shake, spin, seal, read…) with its parameters as quantities or variables, what it acts on, and timing windows, rendered back as plain lab language.
- **Variables:** key values are named and typed, some are inputs chosen per run (number of samples, replicates), some are defaults (well volume), some are read from records (a plate type's dead volume on the pipetting instrument, a lot's CoA working concentration), and some are computed (diluent volume = samples x replicates x well volume + dead volume). Every value shows where it came from.
- **Deep links:** materials and variables link to registry records, so "which SOPs use this plate type" and "what changes if we switch lots" are answerable.
- **Agent digitizer:** an agent turns a library document (011) into a draft digital SOP, cites the passage behind every step and value, marks what it assumed, lists what the source leaves open, and a person confirms section by section.
- **An AI review cycle:** a reviewer model checks the digitizer's draft against the source passages, the digitizer revises, and what the review caught is kept with the draft (G11).
- **A benchmark** on the test set: the iGEM InterLab protocol against its LabOP model, the lab's own SOPs against their front-matter variables, and the messy OpenWetWare SOPs, which must produce flagged questions rather than confident guesses.

## Starting point

- `seed/sops/own/` (11 SOPs) already name variables in front matter (`capture_ab_working_conc`, `standard_points`, `dr_dilution_factor`) with evidence status, and reference labware, reagents and instruments by seed key.
- `seed/assays.yaml` ties SOPs, labware, readouts and layouts into assay templates (017's input).
- 009 R9: a product declares lot-specific fields, an SOP variable links to one, and the value comes from the lot picked when the experiment is planned; before that a typical value shows as estimated.
- 007 L4: dead volume per labware type and per pipetting instrument kind, so a diluent-volume variable links to the exact value it used.
- 008: capability contracts live in code; method steps name capabilities and bind to machines later (000 idea 1.5). Manual stations are instruments too.
- 000 idea 1.7: step timing windows ("read within 30 min of stop") are scheduler constraints with their source.
- The LabOP model of the InterLab protocol (`docs/sop-library/sops/igem-interlab-2022-exp1/labop-protocol.py`) is a machine-readable ground truth to compare against.

## Round 2 answers

Wali chose A for G1 to G6 on 2026-09-29.

## Round 2 questions (as asked): document shape and variables

Recommended option in bold. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| G1 | What shape is a digital SOP? | A) Our own schema in `packages/schema` with fixed sections (overview, materials, solutions, variables, procedure, layout requirements, analysis, timing rules), importing LabOP as a test and an import path · B) Adopt LabOP (SBOL-based) as the internal model · C) Markdown with tagged variables, as in the seed | **A.** LabOP is expressive but built on RDF and SBOL, far from our records, units and links; C can't carry typed steps or links. Checking our model against LabOP's InterLab file keeps us honest. |
| G2 | What is a step? | A) A typed action from a fixed vocabulary aligned with 008's capabilities (add, transfer, serial dilute, mix, wash, incubate, shake, spin, seal, peel, read, image, wait, make solution) plus a "manual" action for anything else, with its text; steps can group and repeat ("wash 3 times") · B) Free text with tagged values · C) Free text, with an optional action | **A.** Transfers, timing and scheduling need to know what a step does. The manual action keeps odd steps ("tap to mix", "pick colonies") honest instead of forcing them into a wrong type. Each step keeps the source wording beside its structure. |
| G3 | How are computed values written? | A) A small expression language of our own, spreadsheet-like, with units checked and exact decimals (`n_samples * replicates * well_volume + dead_volume`), a few functions (ceil, round up to, min, max, sum over a list), evaluated in `packages/domain` · B) mathjs (has units, but floating point) · C) JavaScript or Python snippets · D) No expressions; an agent recomputes values | **A.** Units and exact decimals are rules already (002 T2), which rules out floats; code snippets can't be checked or explained in plain words; D can't be trusted. A small grammar is a few hundred lines with tests. |
| G4 | How does an SOP name its materials and instruments? | A) By role with requirements and a default ("coating plate: 96-well high-binding, default Thermo 442404"; "reader: absorbance at 450 nm"), bound to a concrete labware type, lot or instrument when an experiment is planned; values read from records resolve then, and before that show the default as estimated · B) Hard links to concrete records | **A.** The same ELISA SOP runs on a Greiner plate when Thermo is out of stock, and the lot is only known on the day. Roles with requirements are also what lets 016 and 019 pick instruments. |
| G5 | Where do run-level inputs come from? (number of samples, replicates, which readout) | A) Variables declared as inputs with a type, unit, allowed range and default; an experiment (013) or the agent sets them; all derived values recompute · B) Fixed in the SOP; a new count means a new SOP version | **A.** Diluent volume scaling with sample count is exactly this; B would make every run a new SOP. |
| G6 | How does the digitizer handle what the source leaves unclear? (contradictions, "about 1 µL", missing speeds) | A) It records each as an open question on the step or value, with the passages involved and its suggested answer marked assumed; open questions block confirm until a person answers or accepts the suggestion · B) The agent picks and marks the value assumed · C) It refuses to digitize unclear SOPs | **A.** Assumed values can slip through a quick review; an explicit question can't. The OpenWetWare test SOPs measure this. |

## Round 3 answers

Wali chose A for G7 to G11 on 2026-09-29, with these notes:

- **G8, composition.** Wali sees the workflow creator (018) as the place where SOPs are linked into workflows and larger orchestration. So 012 keeps each SOP one procedure, with clear inputs and outputs per step (what goes in, what plate or solution comes out) so 018 can chain them.
- **G11, an AI review cycle.** Besides the benchmark, digitizing runs a review loop before a person sees the draft: the digitizer drafts; a reviewer (a separate model call with its own instructions, and it can be a different, cheaper model) checks every step and value against the cited source passages and against the readiness checks, and fixes what it finds (wrong value, missed step, unit error, unsupported assumption, missing open question) as tracked changes, see below. The loop stops when the reviewer has no blocking findings or after a set number of rounds (default 2). Findings the loop could not settle stay on the draft as open questions or readiness warnings, and every round is saved with the draft so you can see what the reviewer caught and what changed. A person still confirms; the review never confirms anything. The benchmark scores drafts before and after review, per model pair, so we know whether the loop earns its cost. The same reviewer can be asked to review an existing digital SOP on demand (`sops.review`).

- **Seeing and confirming reviewer fixes (Wali, 2026-09-29).** Both the digitizer and the reviewer are agents; only conversion (011, Docling) and the checks (units, expressions, readiness) are deterministic. Wali expects a cheap reviewer to catch and fix a lot, so the reviewer edits the draft directly instead of only commenting: each fix is its own tracked change with a one-line reason and the passage it relied on, and every value's evidence records who set it (digitizer, reviewer, person). The review screen (004c highlighting against the first draft) marks reviewer fixes separately ("reviewer: 400 µL → 300 µL, step 3 says 300 µL, p. 4"), can filter to them, and lets a person keep a fix, revert to the digitizer's value, or edit it, before confirming the section as usual. The reviewer fixes only what the source settles (the draft contradicts the cited passage, a unit or arithmetic error, a step the source states but the draft missed). Where the source is ambiguous (it contradicts itself, hedges, leaves a value out, or the fix is a judgment call) the reviewer asks instead: an open question with the passages involved and its suggested answer, as in G6, which blocks confirm until a person answers. The benchmark scores before and after review, including whether ambiguous spots became questions rather than silent fixes.

## Round 3 questions (as asked): variants, composition, benchmark

Recommended option in bold. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| G7 | How are variants handled? (96- vs 384-well, the lab's version of a vendor protocol) | A) Scale and format changes are variables in one SOP; a structural change makes a derived SOP that links to its parent and shows a diff · B) Inheritance: a child SOP overrides parts of a parent · C) Always separate, unlinked SOPs | **A.** Inheritance is hard to read at the bench and breaks silently when the parent changes; a diff to the parent shows exactly how the lab's version differs. |
| G8 | Can one SOP call another? | A) No nesting: an SOP is one procedure; a step may point to a recipe or a prerequisite SOP ("prepare reagent diluent per SOP-0004"), and combining SOPs into a run is the job of assay templates (017) and workflows (018) · B) Steps can call a sub-SOP with a variable mapping | **A.** Keeps each SOP readable on its own and keeps composition in one place. B can come later if templates prove too weak. |
| G9 | Is running an SOP at the bench part of 012? | A) No: 012 designs and versions SOPs, and renders a clean printable and tablet view; recording what actually happened comes with experiments (013) and the notebook (021) · B) Add a simple bench checklist that records actual values now | **A.** Recording a run needs experiments, inventory and the ledger to land together; a checklist here would be a second path. |
| G10 | What formats go out and come in? | A) Out: a printable document rendered from the structure. In: library documents via the digitizer, plus a LabOP importer used for the benchmark · B) Full LabOP round trip · C) Also generate Opentrons or Venus code | **A.** Robot code is generated from transfer plans (016), not from SOPs, because it needs a bound instrument and deck. |
| G11 | How is digitizing quality measured? | A) A benchmark in the repo: for each test SOP, expected steps, materials and variables (hand-checked, InterLab from LabOP); a score per section; runs with any model; results in the PR description · B) Judged by eye | **A.** You will switch models (DeepSeek, GLM, Claude); a score tells you which one digitizes well. |

## Defaults I'm assuming (say if any is wrong)

- Plate layout requirements in an SOP are a spec (8-point standard in duplicate, blanks, control columns), not a well map; 014 turns them into a plate map.
- Timing windows are typed constraints on steps (min, max, target with tolerance, "within X of step N"), each with its source (vendor passage, lab convention, lab memory) and whether the scheduler enforces it.
- Handling rules come from the materials (009, 010) and are shown on the SOP, not retyped in it.
- Every step and value cites its source passage (document, page, quote) when digitized; values a person types are credited to them.
- A digital SOP version is immutable once confirmed; experiments pin the version they used, and a new version flags experiments still in planning.

## Proposed split

- **012a:** schema (sections, steps, roles, variables), expression language in `packages/domain` with tests, operations, loader for `seed/sops/own/`. The expression language and `sops.evaluate` (ADR 0036) the SOP record with `sops.draft` and `sops.calculate` (ADR 0037) and the `seed/sops/own` loader are built.
- **012b:** binding and resolution (roles to records, lot and dead-volume values, recompute), readiness checks. Built in `sops.calculate`.
- **012c:** digitizer (agent skill and operations), open questions, review cycle, benchmark. Open questions (`sops.answer_question`), citation checking (`sops.check_citations`), the digitizer skill and the review cycle (`sops.review`, ADR 0038) and the benchmark (`sops.score`, `sop:benchmark`, the InterLab expectation from its LabOP model) built. Expectations for the other test SOPs need a hand check.
- **012d:** SOP page (read and design modes, printable view). Built: the SOPs list and, on an SOP's page, the bench view with run values, questions to settle and checks against the source above the editable sections, with a print view.
