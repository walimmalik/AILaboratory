---
name: ailab-assays
description: Work with assay templates in AILaboratory through its MCP tools: find the lab's templates, draft a template from a conversation and the lab's SOPs, work out what a template gives for a request (missing inputs, conditions, wells and plates) instead of counting yourself, and design an experiment from a confirmed template in one step.
---

# Assay templates in AILaboratory

An **assay template** is the lab's ready-made designer for one assay (an IL-6 ELISA, a CellTiter-Glo dose response). It pins the confirmed digital SOPs it follows and the layout, says which instruments the lab prefers for each role, which few inputs a person must give (the subjects, an SOP input variable), what varies (factors and their levels), the controls and replicates with their reasons, the readouts, quality criteria and the analysis plan. Plan 017; see docs/architecture/assays.md and ADR 0065.

## Default scientific intake

Establish the intended stage from the request and current records: hypothetical planning, reusable method/template, experiment design or physical run preparation. Ask only if unclear. Inspect confirmed templates/SOPs, source passages, registry definitions and confirmed lab memory before asking; reuse facts the person already supplied.

Draft source-settled parts through operations. Find existing supporting definitions first and create necessary vendor, labware type, product or entity drafts with evidence instead of asking the scientist to fill registry forms. These are reusable definitions, not proof of stock: never invent physical specimens, lots, stock, barcodes or instrument availability to make feasibility pass. Actual specimens/lots/containers and dates belong to preparation when late binding is allowed. Current server checks remain authoritative; report a limit rather than bypassing them.

Choose one coherent consequential scientific decision next: why it matters, evidence, supported choices and consequences, and the exact proposed change. Ask essential absent facts once. Couple choices only when their scientific consequences are inseparable. Unknown is not assent, and conversational agreement is not server acceptance. Ordinary proposals wait for human Review; SOP question answers and final confirmations are people-only. No dedicated Apply decision tool is currently available.

Separate scientist-facing procedure (purpose/applicability, materials/roles, ordered instructions, quantities/units, timing/constraints and acceptance criteria) from uncertainty (issue, evidence, next decision) and review (provenance, assumptions, draft state and identifiers). Use schema/kind labels in prose; never write an unresolved setting as a bench instruction. End with completed drafts/results, a focused human decision, a specific blocker or an honest limit; keep investigating while useful operations remain.

Discover only relevant module skills with `skills.list` and `skills.get` (one name per call); `operations.describe` lists summaries with `schema: false`, then accepts needed schemas together by `ids`.

## Finding one

- `assays.search` `{text?, assay?, capability?, status?, limit?}` lists the lab's templates, confirmed first, with what each measures, its readouts and the inputs it asks for. Check it before drafting a template or designing an experiment: "run an ELISA on these 30 supernatants" starts from the lab's ELISA template.

## Drafting one

- `assays.draft_template` with `label`, `purpose`, `assays` (e.g. `["ELISA"]`), `parts: [{id, sop: {id, version}, inputs?: [{name, value}]}]`, `layout?: {id, version}`, `roles`, `essentials`, `factors?`, `design?`, `controls?`, `replicates: {technical, biological?, reason}`, `readouts`, `quality?`, `analysis?`, `hitRule?`, `next?`.
- Pin the SOP and layout versions a person confirmed. A draft SOP or layout can be pinned while drafting, but readiness blocks confirming the template until they are confirmed.
- `roles: [{part, role, capability, preferred?: [instrument kind ids], reason?}]` names an SOP material role by capability, with the instruments the lab prefers; `{part, role, record, version?}` gives a default record (a labware type). The role must be a material role of that part's SOP.
- A part's `inputs` are values every experiment from the template uses (e.g. `well_volume`), for input or default variables of that SOP that the template doesn't ask for.
- `essentials` are the few things the designer asks for: `{input: "subjects", id: "samples", label: "Which samples", kinds?, max?}` or `{input: "variable", id, label, part, variable}` naming an input or default variable of that part's SOP.
- `factors: [{id, label, levels | from | series, baseline?}]`: listed levels, `from` a subjects input (each subject is a level), or a concentration `series`. `design` is `full_factorial` (default) or `one_factor_at_a_time` (needs a baseline per factor).
- `controls: [{id, label, role, subject?, wells, per: plate | run, reason}]`; every control and replicate rule carries its reason.
- Build it from the conversation, the SOPs (`records.list` with `kind: "sop"`, then `records.get`) and the lab's past experiments (`experiments.where_used`). Mark your own guesses assumed in `evidence`. A person edits it with `records.update` and confirms it with `records.confirm`.
- To reuse a confirmed experiment, `assays.save_from_experiment` `{experiment, version?, label}` drafts the template for you: the experiment's SOP versions and the values it set become the parts, and the records it bound become default roles. If the experiment came from a template, the rest is copied from it. Otherwise give `essentials`, `replicates` and `readouts`. Any field you give replaces the copied one.

## Working out a design

- `assays.design` `{template, version?, answers?, wellsPerPlate?, show?}` (or `attributes` to try a template without saving it) returns the essential inputs still missing, the conditions (factors combined), and the wells, plates and runs from the replicate and control rules. Answers go by essential input id: a subjects input takes a count or the record ids, a variable its value.
- Plates hold the template layout's well count unless you give `wellsPerPlate`.
- Use its numbers; never count conditions, wells or plates yourself (ADR 0024). While a factor waits for its input, `conditions` is 0 and totals are left out.

## Designing an experiment from a template

1. `assays.search` for the template, then `assays.design` `{template, answers}` with what the person already told you. Inspect the `missing` inputs and ask only the next consequential missing fact for this stage. Hypothetical counts are planning assumptions, not registered subjects; don't fabricate sample records to satisfy the input.
2. `designer.start` `{template, campaign, aim?, label?, question?, answers}` drafts the experiment, with the template's SOP versions, default records, your variable values, subjects, conditions, controls, readouts and success criteria. When the template has a layout and the subjects are given as records, it drafts the plate map too. The template version must be confirmed. Without `question`, the template's purpose is used and marked assumed.
3. `designer.feasibility` `{experiment}` checks whether the lab can run it. For each instrument role and readout it lists the registered instruments that can do it on this plate format (preferred first) with their status. It also gives the plates and wells, the protocol amounts with what is missing, and `stock`: for every SOP amount with `drawsFrom`, what the bound product, lot or sample holds in inventory less what confirmed transfer plans reserve (enough, short, or unknown). Tell the person plainly what the lab can't do and what it would use instead.
4. Tell the person what was drafted (`lines`) and that they review and confirm each draft. Adjust with `experiments.bind_protocol` and `records.update`. Transfer plans come from the transfers tools once the sources and instrument are known.
