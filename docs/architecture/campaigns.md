# Campaigns, experiments and runs

Plan [013](../plans/013-campaigns-and-experiments.md). The scientific frame every design and bench action hangs from. Decisions: E1 to E12 in the plan, [ADR 0039](../decisions/0039-designs-pin-inputs.md) (designs pin their inputs by version).

## Records (013a)

| Kind | Id, name | Holds | Sections |
| --- | --- | --- | --- |
| `campaign` | `cam_`, `CAM-001` | goal, background, aims (`id`, text, success), owner and contributors, dates, `about` (entities), `references` (documents), `stage` | Goal, Aims, What it is about |
| `experiment` | `exp_`, `EXP-0001` | campaign and aim, question, hypotheses (each with an optional prediction: readout, measure, comparison, threshold), `followsUp`, subjects, `protocol` (parts that each pin an SOP `{id, version}`), documents followed or cited, conditions, controls (each with an optional `subject`, e.g. the DMSO entity, linked as `control`), readouts, success criteria, `stage` | Question, What is tested, Protocol, Conditions and controls, Readouts |
| `run` | `run_`, `RUN-0001` | `experiment` pinned `{id, version}`, status (scheduled, in progress, done, failed, aborted), date, operator, who started it, steps with planned values and actuals, deviations, data files | none; made only by `runs.start` |
| `set` | `set_`, `SET-001` | members (entities, samples or containers, each with a note), the criterion that picked them, the experiment and run it came from | none; made only by `sets.create` |

Code: `packages/schema/src/campaigns.ts`, `apps/api/src/campaigns/`.

Stage is an attribute, separate from the record status, and outside every section, so changing it doesn't send a confirmed record back to review.
- **Campaign stages:** proposed, active, paused, completed and stopped. Only a confirmed campaign can be active.
- **Experiment stages:** designing → planned → running → analysing → concluded. Planned can go back to designing, and analysing can go back to running for another run. On hold and cancelled can be reached from any open stage, and on hold goes back to an open stage. Concluded and cancelled are final.
- **Planning:** moving to planned needs a confirmed record whose readiness is ready. 013b adds binding roles and reserving stock to that step.
- **Stage changes by agents** are proposals.

## Pinned inputs (ADR 0039)

Each protocol part pins a confirmed SOP version. `related` checks every pin with `checkPin` (`apps/api/src/records/pins.ts`). A pin to a missing version, to another kind or to another lab refuses the write. Readiness has three checks: `protocol_confirmed` is a blocker when a pinned version was never confirmed, `protocol_current` warns when a newer confirmed version changed something, and `documents_compute` warns when a followed document isn't digitized. The `protocol_current` warning offers `experiments.adopt_versions` as its one-click fix. A run pins the experiment version it follows, and that version must be confirmed.

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
| `experiments.conclude` (verdict per hypothesis, summary, runs it rests on; stage to concluded) | proposal |
| `sets.create` | proposal |
| `sets.get` (members named, experiments that test the set) | read |

Links: a set `contains` its members and is `picked_by` its experiment; a concluded experiment links its runs and evidence as `evidence`. An experiment is `part_of` its campaign, `follows` its SOPs and followed documents, `references` cited ones, `tests` its subjects, links its control compounds as `control`, and `follows_up` or `repeats_with_changes` an earlier experiment. A run `runs` its experiment. A campaign is `about` entities and `references` documents.

## Recording a run (013c)

`runs.start` pins the experiment's current confirmed version and turns every step of each pinned SOP version into a checklist item with its planned values: fixed parameters, the calculated value of a parameter's variable (from `experiments.calculate`), and `times` for a repeated step. It needs the experiment planned (or already running or analysing) and its protocol to work out, and it moves the experiment to running. The run records who started it; agents record directly into a run a person started and propose into any other (010 V7, E11).

Ticking a step (`runs.record_step`) records it done as planned, with the time and who ticked it. A value given in `changed` that differs from the plan is kept as an actual and makes a deviation on the step (what, planned value, why, impact); `skipped` does the same for a step not done. Both need `why`. `runs.done_as_planned` ticks every step still pending. `runs.record_deviation` records anything else that happened. `runs.attach_data` links a file record (011) to the run, optionally to a step and a container, so analysis (020) can join reads to wells. `runs.finish` ends the run as done (every step ticked or skipped), failed or aborted; a finished run takes no more records.

`apps/api/src/campaigns/runs.ts` holds the run operations.

## Conclusions and sets (013c)

`experiments.conclude` is the only way to concluded (`experiments.set_stage` refuses it). It needs a running or analysing experiment with no run still in progress and at least one finished run, and a verdict (supported, refuted, inconclusive) for every hypothesis, each with the records that show it. The conclusion keeps its summary, the runs it rests on (every finished run unless given), and who concluded and when; runs and evidence are linked as `evidence`. From an agent it is a proposal: the agent drafts, a person confirms (E9).

A set (E10) is a named list of entities, samples or containers with the criterion that picked them and the experiment (and run) it came from. A follow-up experiment lists the set among its subjects, so `sets.get` shows which experiments test it. Sets are made only by `sets.create`, which is a proposal from an agent.

`apps/api/src/campaigns/conclusions.ts` holds these operations.

## The demo campaigns (013a)

`seed/campaigns.yaml` holds two campaigns: BRD4 degraders (a single-point screen, then a HiBiT dose-response that follows up on it) and the IL-6 reporter panel (Dual-Glo, then an ELISA). Each experiment names an assay template in `seed/assays.yaml`, and its protocol pins that template's SOPs at the version the lab has. Subjects, the campaign's `about` and control compounds are entities found by their seed label. `apps/api/src/campaigns/seed.ts` drafts each campaign the lab doesn't have yet (by title) after the SOPs. It leaves out, and reports, any SOP or entity the lab lacks. The seed SOPs are drafts, so the experiments stay in designing, and `protocol_confirmed` blocks planning until a person confirms the SOPs.

## Not yet

Reservations (010 V8: confirmed plans soft-reserve stock) come with the transfer designer (016), which knows exact volumes (Wali, 2026-09-30); SOP defaults are read live rather than pinned when a role is left unbound; scanning containers and lots during a run (inventory fill and consume); 013d screens and the drafting skill in full.
