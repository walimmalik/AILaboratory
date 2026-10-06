---
name: ailab-sops
description: Work with digital SOPs in AILaboratory through its MCP tools: digitize a library document into a draft SOP with cited passages and open questions, check its citations, and work out its formulas (volumes, totals, dilutions) with units and exact decimals.
---

# Digital SOPs in AILaboratory

A digital SOP (plan 012) is a lab procedure as a structured document: materials by role, typed steps, and variables. Variables are inputs per run (samples, replicates), defaults (well volume), values read from records (a plate's dead volume) or formulas over the others. 

## Default scientific intake

Use this workflow for ordinary SOP requests; the person need not ask to be interviewed.

1. Establish whether the request is hypothetical planning, a reusable method, experiment design or physical run preparation from the conversation and current record. Ask only if unclear. Actual specimens, lots, container locations and scheduling belong to experiment/run preparation, not reusable method instructions.
2. Read the current SOP/version, relevant source passages, confirmed methods, registry definitions and confirmed lab memory (`memory.search`). Reuse stated facts. Read only relevant skills: `skills.list` gives the manifest and `skills.get` takes one module per call. Use already offered operation schemas directly. When the relevant skill names the operations needed (for example, `library.read` below), request only their missing schemas together through `operations.describe` by `ids`, without listing the namespace first. Use `operations.describe` with a namespace and `schema: false` only to discover which operations are relevant, then request needed missing schemas by `ids`. `sops.draft` does not require a full `records.kinds` SOP schema read; use `records.kinds {summary: true}` for kinds, sections or keyed-list discovery, and fetch a named kind's attribute schema only when needed for generic `records.create` or another attribute edit.
3. Draft what the sources settle and use `sops.evaluate` or `sops.calculate` for scientific calculations. Find existing supporting definitions first; draft needed vendors, labware types, products or entity definitions through their operations with evidence. Do not send the scientist through registry forms. Never invent physical samples, lots, stock, barcodes, measured values or instrument availability to make readiness pass.
4. Choose one consequential scientific decision next. Explain the issue, why it matters, the source evidence, supported choices and consequences, and the exact proposed change. Coupled choices belong together only when scientifically inseparable. Ask essential absent facts once; avoid unrelated question bundles and repeated readiness paragraphs. Continue useful source work before stopping.
5. Unknown is not assent: “I don't know”, an absent answer or conversational agreement leaves uncertainty unresolved. `sops.answer_question` is people-only; do not emulate it by editing questions with `records.update`. Ordinary write results may be pending proposals; describe the actual human Review action and wait. For the bounded volume-default decision below, prepare a pending decision and wait for the person to apply it; chat agreement never applies it. Other scientific decisions remain outside this Apply path. Current readiness remains authoritative; report stage limitations rather than bypassing checks.
6. End with completed work and its actual state, a focused human decision request, a specific failure/blocker or an honest limit/continuation state. A promise to investigate is insufficient while useful tools remain. On resume, reread records and pending proposal outcomes; transcript agreement is not scientific acceptance.

When continuing a selected question, use its saved responses on the current SOP version as facts already supplied, including an unknown answer. Do not ask the identical question again. An unknown keeps the issue open and disputed settings unchanged: inspect available passages or suggest a specific evidence-seeking action, such as obtaining the missing wash instruction from the protocol owner. Ordinary chat and notes do not save a question response. To save one explicitly, direct the person to **Record response** beneath their reply in this chat, including before any response has been saved; the question response action on the SOP page is an alternative. Only that explicit human action through `sops.answer_question` records the response; never call it as an agent or claim you recorded a response from conversational prose. Recording a response and settling the scientific issue are separate actions.

## Scientist-facing content

Keep three kinds of content distinct:

- **Procedure:** purpose/applicability, materials and their roles, ordered instructions, quantities/units, timing/constraints and acceptance criteria. Use dilution, concentration, standards, controls and replicates precisely. Use labels supplied by the schema/kind rather than technical variable keys in prose.
- **Uncertainty:** a short scientific issue with why it matters, evidence and the next decision. An unresolved setting is not a bench instruction; don't write a suggested wash count as accepted.
- **Review:** provenance, assumptions, agent authorship, draft state and software identifiers in `evidence` and readiness. Avoid repeated “blocking gate”, “QA draft” or adoption bookkeeping in method text. Keep citations and unknowns inspectable.

Actual specimens, lot certificates, available containers and execution dates belong in preparation context when late binding is allowed. A typical product value is not a measured lot value. Missing calculator inputs stay missing.

## Drafting an SOP

- `sops.draft` with `label` and the sections: `materials` (roles like `coating_plate` with `type`, `requirements` and a `default` record id when you know it), `solutions`, `variables`, `steps`, `layout`, `timing`, `questions`, plus `purpose`, `assays` and `source: {document}` when you work from a library document.
- Steps: `{id: "coat", action: "add", text: "…in plain lab words…", uses: ["coating_plate", "capture_ab"], parameters: [{name: "volume", variable: "well_volume"}], produces: [{role: "coated_plate", label: "Coated plate"}]}`. Use `manual` for anything the other actions don't fit; `repeat: 3` for "wash 3 times".
- Variables: `input` for what each run chooses (samples, replicates), `default` for the protocol's default values, `record` for values read from a bound material (`readFrom: {role, field}`, with the typical value as `value`), `computed` with an `expression`. Give an amount the run uses (a total volume of a reagent) `drawsFrom: <material role>`, so experiment designs check it against stock.
- Cite the passage for every step and value (`cite: [{document, passage, page, quote}]`), and put anything the source leaves unclear in `questions` with your suggestion rather than guessing. Mark your own estimates assumed in `evidence`.
- Questions in `sops.draft` use `{id, question, stage: {stage: "method", reason}, about?, suggestion?, passages?}`. The server starts them open with no responses. Never supply disposition or response history. Put question citations in `questions[].passages`, never in scientific field evidence: fieldEvidence.questions, evidence.questions or /questions/... entries.
- Retain every source-described action in source order, including unfinished actions, with a stable step `id`, actual typed action (wash stays wash), neutral title, source-supported text and citation. A conflicting wash setting must not erase the whole wash action or the independently supported read step after it.
- Include settled settings only. Omit unresolved parameter entries and `repeat`; never use zero, empty strings, textual placeholders or guessed values. Put disputed source numbers in question/evidence citations, not operative step prose or parameters. For a known unresolved method setting or conflict of a retained step, include an open method question with `about.step` equal to that step `id`. Link `about.step` only to an actually affected retained step. Keep method-wide gaps or questions about absent source actions as open method questions at SOP level by omitting `about.step`; never invent source actions or attach unrelated questions to wash/read merely to display clarification. For example, link a wash-volume conflict to wash; a capture-antibody question with no retained coating step and a missing whole procedure must not be linked to wash or read. Use `sops.draft` to create these steps and linked questions atomically.
- A linked open method question makes that step **Needs clarification** and blocks final confirmation. Replies, wording corrections, ordinary step edits and discussion do not resolve it. Preserve stable step/question IDs and existing question history when editing a draft. The server does not automatically detect missing action settings if no question was declared: a bare wash without a linked question is not evidence of a scientifically complete method.
- `sops.ask_question` with `{sop, expectedVersion, question: <the same typed question>, reason?}` appends a question to the current draft. Never add, omit or edit the questions array through `records.update` or restore.
- An experiment question requires `{stage: "experiment", reason, binding: {type: "input", variable}}` with matching `about.variable` on an input-kind variable, or `{type: "material_role", role}` with matching `about.material` on a role with no default. It cannot concern a step, constant or formula. The pinned experiment must supply that input or material. Run-stage questions are refused until a concrete run-preparation consumer exists.
- Check `records.readiness`: unresolved method questions, broken formulas and timing that isn't a time block confirming. Later-stage obligations remain visible. A reply, including "I don't know", never improves method readiness.
- `sops.calculate` with `{sop, bindings: [{role: "capture_ab", record: "lot_…"}], inputs: [{name: "n_samples", value: "24"}]}` gives every variable for a run and where it came from: a picked lot's certificate value, a plate type's `deadVolume`, a product's typical value until a lot is picked. Roles without a binding use their default. Tell the person which values are still typical. Inputs outside a variable's `min`/`max`, in the wrong kind of unit, or given twice are refused; ask the person rather than forcing a value.

## One draft volume-default decision

Use `review.prepare_decision` with `{sop, expectedVersion, variable, value: {value: "80", unit: "uL"}, reason}` for one existing uncited scalar volume default on a never-confirmed draft. The old and new values must be positive and use exactly the same recognized volume unit. Bounds, citations, input/record/computed variables and an open method question explicitly naming the variable are unsupported; never change shape or evidence to evade refusal. Read the current version first. Never supply operation names, paths, checks, dependencies or provenance.

The result is `status: "proposed"`, with the one persisted pending proposal. Scientific values have not changed. Explain the exact old/new volume, normal evidence update and entire Values section review scope, including its other assumptions and unchecked values. Full server checks and remaining questions are in its typed preview. Stop and wait for the person; the assistant pauses and skips later calls. Preparation must be a separate call, never a change-set step.

Only a person calls `proposals.approve` with `{id, expectedPreview: proposal.decision.previewIdentity.digest}`. Apply checks the current method and dependencies under locks. A returned proposal still `pending` with `previewStatus: "refreshed"` or `"stale"` means nothing was applied: explain the returned preview and require another click using its current digest. Never call approval as an agent or describe pending refresh as success. Approved output has the durable committed receipt; retries return that result without another write. `proposals.reject` rejects the same pending proposal. Final SOP confirmation is separate: this change leaves the SOP draft and unrelated questions open, with no claim of scientific validation, source adoption or question resolution.
## Accept one existing experiment input

Use `review.prepare_decision` with `{sop, expectedVersion, question: "count", reason}` only for one existing open experiment-stage question bound to its declared input on a never-confirmed draft. Do not mix this selector with volume fields. Read the current SOP first; never supply a condition, stage, binding, proposal ID, operation, disposition, approver or provenance. Method questions, material/run obligations, reclassification, resolution and reopening are unsupported here.

Explain the server preview as **Accept as an experiment input** and **Still required for every experiment.** The same question wording, responses, stage/binding, input definition, method values, sources, scientific evidence and section reviews stay intact. The server derives the explicit-input obligation. Acceptance does not answer the input, settle a method question or improve method validity. Every experiment must still supply a valid explicit value, even if the SOP has an input default.

Preparation returns the existing pending proposal and pauses the assistant; stop and wait. Only a person applies through `proposals.approve` with the displayed digest, using the same refreshed/stale/new-click rules above. Actual accepting person, original proposer/request and durable receipt are retained. The SOP remains draft; final SOP confirmation is separate. A deferred question may receive ordinary responses, but wording correction requires reconsideration. Never remove the question, convert/delete its bound input or relabel it to evade refusal.

## Digitizing a library document

1. `library.read` the document's outline, then each section (`section`), or `library.search` for what you need. Note each passage's `id`.
2. Draft with `sops.draft` and `source: {document}`. Cite every step and value with the passage `id` and the exact words (`quote`), copied, not paraphrased.
3. Where the source is unclear (it contradicts itself, says "about", leaves a speed or time out), add an open question with the `passages` involved and your `suggestion`. Don't pick silently.
4. Run `sops.check_citations`. Fix every `not_found` quote (copy the source's words) and every `found_elsewhere` one (cite the passage it names in `foundIn`), then check again.
5. Run `sops.review` (`{sop, expectedVersion}`) to have the reviewer check the draft against the source, then read what it changed with `sops.reviews` and tell the person.
6. Check `records.readiness` and tell the person what is open. `sops.answer_question` is people-only: `{sop, expectedVersion, question: <id>, action: {type: "response", text}}` records a response; `{type: "correct", text, reason}` corrects unaccepted wording only while preserving identity, stage, responses and the unresolved obligation. Neither settles the issue. Only the bounded existing experiment-input acceptance above is supported through the common proposal entrypoint; broader scientific resolution remains pending SG-03. A suggestion alone cannot be accepted as scientific resolution. Only a person confirms the final draft.

Current question passages retain `{document, passage?, page?, quote}`. These references are not immutable edition evidence; do not invent exact source pins. Until SG-10c provides the revision/history workflow, any SOP that has ever been confirmed refuses editing or reconciliation. Create a separate new draft. Raw historical snapshots remain readable; unsupported old question payloads are refused at scientific-use boundaries.

`library.read` with `passages: [id, …]` reads cited passages back by id.

## Filling in part of an SOP

`sops.suggest` asks the assistant's model for one part of an SOP while a person edits it: `{sop, attributes?, value: "diluent"}` for a value, `step: "coat"` for a step's settings and uses, `newStep: "wash three times"` for a new step, or `steps: true` to draft every step from the source document. Give exactly one, and pass `attributes` when the SOP as edited differs from what is stored. The answer is checked (formulas with the calculator, steps against the SOP's materials and values) and returned; nothing is saved. The editor uses it; when you draft or change an SOP yourself, write the parts directly with `sops.draft` or `records.update` instead.

## Common refusals

| Refusal | What to do |
| --- | --- |
| A step uses a material or value the SOP doesn't have (`invalid_attributes`) | Add the material or variable in the same update, or use one that exists |
| A formula names a value that doesn't exist, or mixes units that don't add (a volume plus a time) | Fix the expression; check it with `sops.evaluate` first |
| `sops.calculate`: an input outside its `min`/`max`, in the wrong kind of unit, given twice, or given for a computed value | Ask the person for the value; give a computed value's inputs instead |
| A question rewrite through generic records operations | Use `sops.ask_question` to append or a person's `sops.answer_question` response/wording correction; retain earlier questions and history |
| `sops.review` on an SOP that isn't a draft, or at an old `expectedVersion` | Read it again with `records.get` |
| `invalid_state`: no model is set up for the reviewer or the assistant | Tell the person; the lab's model is set in its `.env` |

## The benchmark

To compare models, digitize a document that has an expectation in `seed/sop-benchmark/` (its `document` is the library title), then `sops.score` with `{sop, expected}` gives each section's share found and what is missing. People run all of them with `pnpm --filter @ailab/api sop:benchmark`.

## Formulas

- Use `sops.evaluate` for every number an SOP computes; never do the arithmetic yourself (ADR 0024).
- Give each variable a `value` (a decimal string like `"40"`, a quantity like `{"value": "100", "unit": "uL"}`, or a list of those) or an `expression`, and optionally the `unit` a formula's result should be in. Order doesn't matter.
- Write numbers with their units: `50 uL`, `1.5 mg/mL`, `2 h`, `37 degC`. Units are checked: a volume plus a time is refused, a concentration over a concentration is a plain number.
- Functions: `ceil`, `floor`, `round` (plain numbers), `roundup(x, step)` and `rounddown(x, step)` (e.g. to whole mL), `min`, `max`, `sum` and `count` (lists spread in).
- A variable without a value makes the formulas that use it wait; the result says which. Say what is missing rather than inventing it.

Example, diluent for a run with 10 % extra, rounded up to a whole mL:

```json
{"variables": [
  {"name": "diluent", "expression": "roundup((n_samples * replicates * well_volume) * 1.1 + dead_volume, 1 mL)", "unit": "mL"},
  {"name": "n_samples", "value": "40"},
  {"name": "replicates", "value": "2"},
  {"name": "well_volume", "value": {"value": "100", "unit": "uL"}},
  {"name": "dead_volume", "value": {"value": "5", "unit": "mL"}}]}
```

It returns `diluent` as 14 mL (8.8 mL plus 5 mL, rounded up).
