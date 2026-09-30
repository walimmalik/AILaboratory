# Campaigns, experiments and runs

Plan [013](../plans/013-campaigns-and-experiments.md). The scientific frame every design and bench action hangs from. Decisions: E1 to E12 in the plan, [ADR 0039](../decisions/0039-designs-pin-inputs.md) (designs pin their inputs by version).

## Records (013a)

| Kind | Id, name | Holds | Sections |
| --- | --- | --- | --- |
| `campaign` | `cam_`, `CAM-001` | goal, background, aims (`id`, text, success), owner and contributors, dates, `about` (entities), `references` (documents), `stage` | Goal, Aims, What it is about |
| `experiment` | `exp_`, `EXP-0001` | campaign and aim, question, hypotheses (each with an optional prediction: readout, measure, comparison, threshold), `followsUp`, subjects, `protocol` (parts that each pin an SOP `{id, version}`), documents followed or cited, conditions, controls, readouts, success criteria, `stage` | Question, What is tested, Protocol, Conditions and controls, Readouts |
| `run` | `run_`, `RUN-0001` | `experiment` pinned `{id, version}`, status (scheduled, in progress, done, failed, aborted), date, operator | none yet (013c adds step actuals) |

Code: `packages/schema/src/campaigns.ts`, `apps/api/src/campaigns/`.

Stage is an attribute, separate from the record status, and outside every section, so changing it doesn't send a confirmed record back to review.
- **Campaign stages:** proposed, active, paused, completed and stopped. Only a confirmed campaign can be active.
- **Experiment stages:** designing → planned → running → analysing → concluded. Planned can go back to designing, and analysing can go back to running for another run. On hold and cancelled can be reached from any open stage, and on hold goes back to an open stage. Concluded and cancelled are final.
- **Planning:** moving to planned needs a confirmed record whose readiness is ready. 013b adds binding roles and reserving stock to that step.
- **Stage changes by agents** are proposals.

## Pinned inputs (ADR 0039)

Each protocol part pins a confirmed SOP version. `related` checks every pin with `checkPin` (`apps/api/src/records/pins.ts`). A pin to a missing version, to another kind or to another lab refuses the write. Readiness has three checks: `protocol_confirmed` is a blocker when a pinned version was never confirmed, `protocol_current` warns when a newer confirmed version changed something, and `documents_compute` warns when a followed document isn't digitized. The `protocol_current` warning offers `experiments.adopt_versions` as its one-click fix. A run pins the experiment version it follows, and that version must be confirmed.

## Operations

| Operation | Agents |
| --- | --- |
| `campaigns.draft`, `experiments.draft` | direct (drafts; campaigns start proposed, experiments designing) |
| `campaigns.set_stage`, `experiments.set_stage` | proposal |
| `experiments.adopt_versions` | direct on drafts, proposal on active |
| `experiments.where_used` (campaigns, experiments and runs using a record, optionally one version) | read |

Links: an experiment is `part_of` its campaign, `follows` its SOPs and followed documents, `references` cited ones, `tests` its subjects and `follows_up` or `repeats_with_changes` an earlier experiment. A run `runs` its experiment. A campaign is `about` entities and `references` documents.

## Not yet

013b protocol binding (roles, inputs, recompute, reservations), 013c run recording, conclusions and sets, 013d screens and the drafting skill in full, and the demo campaign in the seed.
