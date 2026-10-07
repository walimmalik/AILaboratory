---
name: ailab-campaigns
description: Work with campaigns, experiments and runs in AILaboratory through its MCP tools: draft a campaign with aims, draft an experiment that pins the confirmed SOP versions it follows, bind their roles and inputs and work the run out, move stages, adopt newer SOP versions, record runs at the bench, and find every experiment or run that used a record.
---

# Campaigns, experiments and runs in AILaboratory

A **campaign** is a lab project with a goal and aims. An **experiment** is one question in a campaign, with the confirmed SOP versions it follows. A **run** is one execution of an experiment's confirmed design on a day. Plan 013; see docs/architecture/campaigns.md.

## Drafting

First distinguish hypothetical planning, reusable method work, experiment design and physical run preparation using the request/current records; ask only if unclear. Read confirmed methods, registry definitions and lab memory before asking for missing facts. Draft source-settled work and supporting reusable definitions through operations with evidence. Never invent specimens, lots, containers or stock for feasibility. Actual preparation facts belong here rather than in reusable SOP instructions when late binding is allowed; current readiness still controls acceptance. Ask one consequential decision at a time with evidence and consequences. Unknown is not assent, and conversational agreement cannot confirm records or resolve SOP questions. Finish with actual drafts/calculator results, a focused decision, a specific blocker or an honest limit rather than an unfulfilled promise.

- `campaigns.draft` with `label`, `goal`, `aims: [{id: "aim_1", text, success}]`, and optionally `background`, `owner`, `about` (entity ids) and `references` (document ids). It starts as proposed.
- `experiments.draft` with `label`, `campaign`, `aim` (an aim id of that campaign), `question`, `hypotheses: [{id, statement, prediction?: {readout, measure, comparison, threshold}}]`, `subjects: [{record}]`, `protocol`, `conditions`, `controls: [{id, label, role}]`, `readouts: [{id, label}]` and `successCriteria`. A prediction's `readout` must be one of the readout ids. To design from one of the lab's assay templates, use `designer.start` (assays skill) instead: it fills all of this from the template and pins it as `template`.
- `protocol: [{id: "coating", sop: {id: "sop_…", version: 4}}]` pins an SOP version. Pin the version a person confirmed (the SOP's current version when its status is active). A draft SOP's version can be pinned while designing, but it blocks planning. A document that isn't digitized goes in `documents: [{document, use: "follows"}]`, and nothing computes from it.
- Mark your own estimates assumed in `evidence`, and check `records.readiness`.

## Binding the protocol

- `experiments.bind_protocol` `{id, expectedVersion, part, bindings: [{role, record, version}], inputs: [{name, value}]}` fills what an SOP leaves open for this experiment. Pin labware types, products, lots, instrument kinds and entities by `version` (their current version when active). Bind containers, samples and instruments by id only. `unbind: [role]` and `clear: [name]` go back to the SOP's default.
- `experiments.calculate` `{id}` works out every part as pinned: volumes, totals, a lot's certificate value. Use its numbers; don't do the arithmetic yourself. Its `problems` list what is missing, and planning needs it empty.
- `experiments.plan_check` `{id}` lists what else planning needs: the subjects (what is tested), and confirmed plate maps (at least one when its template has a layout; every plate map drafted for it confirmed). Each blocker names the record to fix in `record` when it is another one. `experiments.set_stage` refuses `planned` until it is empty, so check it before proposing the move.

## Stages

- `campaigns.set_stage` and `experiments.set_stage` take `{id, expectedVersion, stage}`. From an agent they are proposals a person confirms.
- An experiment is planned only once a person has confirmed its design and readiness is ready.

## Recording a run

- `runs.start` `{experiment, expectedVersion, label?, date?, operator?}` starts a run of a planned experiment at the version you looked at; if the experiment changed since, the start (or its approval) is refused with `version_conflict`. The run lists every step with its title, instruction `text` captured from the pinned SOP version, and planned values. A newer SOP cannot change those captured instructions. From an agent it is a proposal.
- `runs.record_step` `{id, expectedVersion, part, step}` ticks a step as done as planned. Only when something differed, add `changed: [{name, value}]` and `why` (and `impact` if known); `skipped: true` with `why` records a step not done. `runs.done_as_planned` ticks every remaining step.
- `runs.record_deviation` `{what, why, impact?}` records anything else that went differently. `runs.attach_data` `{file, part?, step?, container?, note?}` links an uploaded file (`files.upload`) to the run.
- `runs.finish` `{status: done | failed | aborted, note?}`. Done needs every step ticked or skipped. Finishing a run that was not aborted reports each value recorded differently from the plan to lab memory (`memory.observe`, detector `runs.recurring_deviation`); the same change in 3 runs on 2 days becomes a proposed lesson a person confirms.
- `runs.correct` records what someone says afterwards about a finished run ("incubated 45 min, not 30" in a notebook entry that evening). For a step's value give `{part, step, changed, why, source?}`, the same shape as `runs.record_step`, so lab memory can group the deviation; for anything else give `{what, why, impact?, source?}`. Put where it was said in `source`. Yours are proposals a person confirms; the run keeps its finish time and the history shows the correction.
- In a run a person started, your records go in directly; otherwise they are proposals. Filling a run from notes or a photo: tick only what the notes say, and put anything unclear in a deviation rather than guessing.
- Captured instructions are immutable even through generic updates, restores and approved proposals; corrections record actual differences without rewriting the instructions. An older run may have no captured `text`. Keep that absence explicit and never backfill it from a current SOP or invent bench instructions. Capture alone does not show that a source was complete, that physical preparation is ready or that hardware behavior was validated.

## Concluding and handing hits on

- `experiments.conclude` `{id, expectedVersion, summary, verdicts: [{hypothesis, verdict: supported | refuted | inconclusive, evidence: [{record, note}]}], runs?}` concludes a running or analysing experiment once its runs are finished. Give a verdict for every hypothesis and cite the runs, files or analyses; take numbers from analyses, not your own arithmetic. From an agent it is a proposal a person confirms.
- `sets.create` `{label, members: [{record, note}], criterion, from: {experiment, run?}}` makes the list of hits one experiment hands on; put the value that qualified each member in its note. A follow-up experiment lists the set in `subjects`. `sets.get` `{id}` names the members and the experiments testing the set.

## Newer SOP versions

When an SOP or bound record an experiment pins has a newer confirmed version, readiness says so (`protocol_current`). Tell the person what changed (`records.history` of the SOP), then `experiments.adopt_versions` `{id, expectedVersion}` moves every pin to the latest confirmed version. Never re-pin silently.

## Where a record was used

`experiments.where_used` `{record, version?}` lists the campaigns, experiments and runs that use a record: "which runs followed SOP-0004 v3", "which experiments tested ENT-0012".

## Open an experiment workspace

`experiments.workspace` is read only. Give `{id, expectedVersion?, view}` whose `view` has `panel` equal to `design`, `plates` or `transfers`. Initial entry may omit `expectedVersion`; subsequent navigation uses the returned `selection`'s `version`. A successful response contains the same validated selection and `href` for browser and MCP callers. Offer `href` as **Open view**; do not say a browser displayed it merely because the operation succeeded. Opening a view confirms nothing, reserves no stock and changes no scientific records.

All list pages accept `{offset, limit}` (default 0/20, maximum 50), and return exact `total` and `hasMore`. Design pages direct experiment references without expanding sets or SOP defaults. Plates pages saved maps; select `{map: {id, version, plate, wells?, relatedPage?}}` for one 1-based plate and at most 64 distinct focused wells. Transfers pages saved plans; select `{plan: {id, version, group?, groupsPage?, rowsPage?, relatedPage?}}` for group metadata and paged persisted movement rows with named endpoints. Rows need a selected group. Selected maps, plans, groups and details may be outside the visible page. W1 does not support search, addition selectors, arbitrary filters or color metrics.

For a directly referenced supporting record, set `view.detail: {id, version}`. Its bounded overview uses the exact relationship pin and preserves field evidence; unpinned relationships use the current record. Secondary inventory/location/name reads are explicitly current, not a historical stock snapshot. Omission counts identify facts available through Open full record. A detail must belong to this experiment's direct references or the selected map/plan scope: the presence of an arbitrary record in the lab is insufficient.

On `version_conflict`, explain that the selected science changed and ask the person to refresh explicitly; do not silently pick the latest record or another plate. Missing/foreign-lab selections refuse without revealing foreign metadata. Continue calculations, edits, confirmations and export through their owning operations and existing authority. Workspace readiness is the stored record readiness, not a new scientific validation.
