# Campaigns, experiments and runs

Plan [013](../plans/013-campaigns-and-experiments.md). The scientific frame every design and bench action hangs from. Decisions: E1 to E12 in the plan, [ADR 0039](../decisions/0039-designs-pin-inputs.md) (designs pin their inputs by version).

## Records (013a)

| Kind | Id, name | Holds | Sections |
| --- | --- | --- | --- |
| `campaign` | `cam_`, `CAM-001` | goal, background, aims (`id`, text, success), owner and contributors, dates, `about` (entities), `references` (documents), `stage` | Goal, Aims, What it is about |
| `experiment` | `exp_`, `EXP-0001` | campaign and aim, question, hypotheses (each with an optional prediction: readout, measure, comparison, threshold), `followsUp`, subjects, `protocol` (parts that each pin an SOP `{id, version}`), `template` (the confirmed assay template version it was designed from, linked `from_template`, plan 017b), documents followed or cited, conditions, controls (each with an optional `subject`, e.g. the DMSO entity, linked as `control`), readouts, success criteria, `stage` | Question, What is tested, Protocol, Conditions and controls, Readouts |
| `run` | `run_`, `RUN-0001` | `experiment` pinned `{id, version}`, status (scheduled, in progress, done, failed, aborted), date, operator, who started it, steps with planned values and actuals, deviations, data files | none; made only by `runs.start` |
| `set` | `set_`, `SET-001` | members (entities, samples or containers, each with a note), the criterion that picked them, the experiment and run it came from | none; made only by `sets.create` |

Code: `packages/schema/src/campaigns.ts`, `apps/api/src/campaigns/`.

Stage is an attribute, separate from the record status, and outside every section, so changing it doesn't send a confirmed record back to review.
- **Campaign stages:** proposed, active, paused, completed and stopped. Only a confirmed campaign can be active.
- **Experiment stages:** designing → planned → running → analysing → concluded. Planned can go back to designing, and analysing can go back to running for another run. On hold and cancelled can be reached from any open stage, and on hold goes back to an open stage. Concluded and cancelled are final.
- **Planning:** moving to planned needs a confirmed record whose readiness is ready. 013b adds binding roles and reserving stock to that step.
- **Stage changes by agents** are proposals.

## Pinned inputs (ADR 0039)

Each protocol part pins a confirmed SOP version. `related` checks every pin with `checkPin` (`apps/api/src/records/pins.ts`). A pin to a missing version, to another kind or to another lab refuses the write. Readiness has three checks: `protocol_confirmed` is a blocker when a pinned version was never confirmed (it names the record by label and code, and when that record is still a draft the check's `record` links to it, since the fix is to confirm it there; plate maps and assay templates do the same with `waitingOn`), `protocol_current` warns when a newer confirmed version changed something, and `documents_compute` warns when a followed document isn't digitized. The `protocol_current` warning offers `experiments.adopt_versions` as its one-click fix. A run pins the experiment version it follows, and that version must be confirmed.

## Binding the protocol (013b)

Each protocol part carries `bindings` (the SOP's material roles bound to records) and `inputs` (values for its input and default variables, such as `n_samples`). Roles and inputs that are left out use the SOP's own default record and value.
- **Definitions are pinned.** Labware types, products, lots, instrument kinds, equipment kinds and entities are bound with their `version` (ADR 0039).
- **Physical things are not.** Containers, samples and instruments are bound by id alone and checked live.
- **What `related` refuses:** a role or input the pinned SOP version doesn't have, a computed variable given as input, a definition without its version, and a version on a physical thing.
- **What readiness flags:** a record of the wrong kind for its role (`bindings_fit`, blocker), an unconfirmed pinned version (`protocol_confirmed`, blocker), and a newer confirmed version of a bound record (`protocol_current`, warning).

`experiments.calculate` works out every part through `sops.calculate`. It uses the SOP at its pinned version and reads each bound record at its pinned version (`sops.calculate` takes `version`, and a binding's `version`), then lists what is missing or doesn't fit. Moving to planned needs that list to be empty. `experiments.adopt_versions` also moves pinned bindings to their latest confirmed version. When a newer SOP version drops a role or variable, adopting drops its binding or input and says so in the reason.

## Operations

| Operation | Agents |
| --- | --- |
| `campaigns.draft`, `experiments.draft` | direct (drafts; campaigns start proposed, experiments designing) |
| `campaigns.set_stage`, `experiments.set_stage` | proposal |
| `experiments.bind_protocol` (roles and inputs of one part; `unbind`, `clear`) | direct on drafts, proposal on active |
| `experiments.calculate` (every part worked out as pinned) | read, calculator |
| `experiments.adopt_versions` | direct on drafts, proposal on active |
| `experiments.where_used` (campaigns, experiments and runs using a record, optionally one version) | read |
| `runs.start` (an in-progress run of a planned experiment, as a checklist) | proposal |
| `runs.record_step`, `runs.done_as_planned`, `runs.record_deviation`, `runs.attach_data`, `runs.finish` | direct in a run a person started, proposal otherwise |
| `runs.correct` | proposal |
| `experiments.conclude` (verdict per hypothesis, summary, runs it rests on; stage to concluded) | proposal |
| `sets.create` | proposal |
| `sets.get` (members named, experiments that test the set) | read |

Links: a set `contains` its members and is `picked_by` its experiment; a concluded experiment links its runs and evidence as `evidence`. An experiment is `part_of` its campaign, `follows` its SOPs and followed documents, `references` cited ones, `tests` its subjects, links its control compounds as `control`, and `follows_up` or `repeats_with_changes` an earlier experiment. A run `runs` its experiment. A campaign is `about` entities and `references` documents.

## Recording a run (013c)

`runs.start` takes the experiment version the caller looked at and refuses with `version_conflict` if it is no longer current, so an approved proposal starts exactly what its preview showed (ADR 0016). It pins that confirmed version and turns every step of each pinned SOP version into a checklist item with its planned values: fixed parameters, the calculated value of a parameter's variable (from `experiments.calculate`), and `times` for a repeated step. It needs the experiment planned (or already running or analysing) and its protocol to work out, and it moves the experiment to running. The run records who started it; agents record directly into a run a person started and propose into any other (010 V7, E11).

Ticking a step (`runs.record_step`) records it done as planned, with the time and who ticked it. A value given in `changed` that differs from the plan is kept as an actual and makes a deviation on the step (what, planned value, why, impact); `skipped` does the same for a step not done. Both need `why`. `runs.done_as_planned` ticks every step still pending. `runs.record_deviation` records anything else that happened. `runs.attach_data` links a file record (011) to the run, optionally to a step and a container, so analysis (020) can join reads to wells. `runs.finish` ends the run as done (every step ticked or skipped), failed or aborted; a finished run takes no more checklist records. `runs.correct` records what is said about it afterwards (from the 021 notebook review): a step's values in the same structured form as `runs.record_step`, which rebuilds the step's actuals and deviation and appends a correction (when, who, why, source), or a deviation marked `corrected`. The finish time stays; the record's history keeps the earlier values. The run kind holds this on every write, generic updates and restores included (ADR 0041): a run keeps the experiment version, start and checklist (steps and planned values) it started with, a finished run is not reopened, and its steps and deviations change only with a correction. People record corrections directly, agents propose them, and an agent's carries evidence `stated` with its source.

The module's lab memory detector (005c-1, `campaigns/detectors.ts`): `runs.finish` on a run that wasn't aborted reports each step value recorded differently from the plan to `memory.observe` as `runs.recurring_deviation`, keyed by SOP version, step, field and direction (higher, lower, or the value set), never the free-text reason. Seen in 3 runs on 2 days, it becomes one proposed lesson about the SOP. See [memory.md](memory.md).

`apps/api/src/campaigns/runs.ts` holds the run operations.

The run overview chooses the same simple run facts: execution status, date, start and finish when
recorded. It labels execution state **run status**, distinct from the record's confirmation in
the page header. Start and finish retain their ISO values in `records.overview`; the run page
formats those two facts in the reader's time zone using the same formatter as checklist times.

### Captured step instructions (004g / SG-09 slice)

`runs.start` also copies each step's complete `text` from the already pinned SOP record snapshot,
alongside its existing title and resolved planned values. `RunStep.text` is the instruction as
captured when that run started. It is never looked up from a current SOP or replaced by a title.
The run kind includes it in the immutable checklist comparison, so generic updates, restores and
saved proposal approval cannot change, delete or retrospectively add it. Recording ticks, skips,
deviations, finishing and later corrections preserves it.

Older runs may lack `text`; that records uncaptured history rather than an empty instruction.
They remain readable and recordable without backfilling from any later SOP. This slice
captures only the instruction already present in the pinned SOP. It does not establish source
completeness, repair seed instructions, resolve a full run manifest or validate hardware behavior.
The run checklist displays the captured instruction with its line breaks, alongside planned
values and deviations. Identical title and instruction text appears once. For absent text it
states “Instruction text was not captured for this run.” The record API exposes the same field
to agents. Complete SG-09/SG-13 acceptance remains separate work.

## Conclusions and sets (013c)

`experiments.conclude` is the only way to concluded (`experiments.set_stage` refuses it). It needs a running or analysing experiment with no run still in progress and at least one finished run, and a verdict (supported, refuted, inconclusive) for every hypothesis, each with the records that show it. The conclusion keeps its summary, the runs it rests on (every finished run unless given), and who concluded and when; runs and evidence are linked as `evidence`. From an agent it is a proposal: the agent drafts, a person confirms (E9).

A set (E10) is a named list of entities, samples or containers with the criterion that picked them and the experiment (and run) it came from. A follow-up experiment lists the set among its subjects, so `sets.get` shows which experiments test it. Sets are made only by `sets.create`, which is a proposal from an agent.

`apps/api/src/campaigns/conclusions.ts` holds these operations.

## Screens (013d)

The menu has an Experiments group: Campaigns, Experiments, Runs and Sets, each a list with its key facts (stage, aims, runs done of total, members). `apps/web/src/pages/Experiments.tsx` adds blocks to the record page, summaries first:

- **Campaign:** each aim with the experiments serving it, their stage and their conclusion.
- **Experiment:** a Next step block with its stages in order (done ones ticked, the current one in full ink; none for on hold or cancelled, which the block's header names), whether the protocol works out (problems folded away), and the one or two actions its stage allows (plan it, start a run, analyse, conclude with a verdict per hypothesis); then its runs and its conclusion. The design stays in the section blocks.
- **Run:** a checklist of the pinned steps with their planned values. Each step is ticked "Done as planned", or "Something differed" (type only the values that differed, and why) or "Skipped" (why). "The rest went as planned" ticks what's left, and the run is finished as done, failed or aborted. Other deviations are recorded below.
- **Set:** its members with their notes, why they made it, and the experiments that test it.

Every button calls an operation; the pure rules (which actions a stage allows, run progress) are in `apps/web/src/lib/experiments.ts`.

Changed checklist values appear once as labelled Planned and Recorded lines, using unit-aware
formatting. Why and Impact follow as separate lines. Only an exact duplicate of the server-generated
value comparison is omitted; additional deviation explanation remains visible. Captured instructions,
unchanged steps, pending steps and skipped-step reasons retain their existing meaning.

## The demo campaigns (013a)

`seed/campaigns.yaml` holds two campaigns: BRD4 degraders (a single-point screen, then a HiBiT dose-response that follows up on it) and the IL-6 reporter panel (Dual-Glo, then an ELISA). Each experiment names an assay template in `seed/assays.yaml`, and its protocol pins that template's SOPs at the version the lab has. Subjects, the campaign's `about` and control compounds are entities found by their seed label. `apps/api/src/campaigns/seed.ts` drafts each campaign the lab doesn't have yet (by title) after the SOPs. It leaves out, and reports, any SOP or entity the lab lacks. The seed SOPs are drafts, so the experiments stay in designing, and `protocol_confirmed` blocks planning until a person confirms the SOPs.

## Not yet

Reservations (010 V8: confirmed plans soft-reserve stock) come with the transfer designer (016), which knows exact volumes (Wali, 2026-09-30); SOP defaults are read live rather than pinned when a role is left unbound; scanning containers and lots during a run (inventory fill and consume); attaching data files from the run screen (the operation exists); a campaign flow drawing of experiments and the sets between them.
