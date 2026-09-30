---
name: ailab-sops
description: Work with digital SOPs in AILaboratory through its MCP tools: digitize a library document into a draft SOP with cited passages and open questions, check its citations, and work out its formulas (volumes, totals, dilutions) with units and exact decimals.
---

# Digital SOPs in AILaboratory

A digital SOP (plan 012) is a lab procedure as a structured document: materials by role, typed steps, and variables. Variables are inputs per run (samples, replicates), defaults (well volume), values read from records (a plate's dead volume) or formulas over the others. 

## Drafting an SOP

- `sops.draft` with `label` and the sections: `materials` (roles like `coating_plate` with `type`, `requirements` and a `default` record id when you know it), `solutions`, `variables`, `steps`, `layout`, `timing`, `questions`, plus `purpose`, `assays` and `source: {document}` when you work from a library document.
- Steps: `{id: "coat", action: "add", text: "…in plain lab words…", uses: ["coating_plate", "capture_ab"], parameters: [{name: "volume", variable: "well_volume"}], produces: [{role: "coated_plate", label: "Coated plate"}]}`. Use `manual` for anything the other actions don't fit; `repeat: 3` for "wash 3 times".
- Variables: `input` for what each run chooses (samples, replicates), `default` for usual values, `record` for values read from a bound material (`readFrom: {role, field}`, with the typical value as `value`), `computed` with an `expression`.
- Cite the passage for every step and value (`cite: [{document, passage, page, quote}]`), and put anything the source leaves unclear in `questions` with your suggestion rather than guessing. Mark your own estimates assumed in `evidence`.
- Check `records.readiness`: open questions, broken formulas and timing that isn't a time block confirming.
- `sops.calculate` with `{sop, bindings: [{role: "capture_ab", record: "lot_…"}], inputs: [{name: "n_samples", value: "24"}]}` gives every variable for a run and where it came from: a picked lot's certificate value, a plate type's `deadVolume`, a product's typical value until a lot is picked. Roles without a binding use their default. Tell the person which values are still typical. Inputs outside a variable's `min`/`max`, in the wrong kind of unit, or given twice are refused; ask the person rather than forcing a value.

## Digitizing a library document

1. `library.read` the document's outline, then each section (`section`), or `library.search` for what you need. Note each passage's `id`.
2. Draft with `sops.draft` and `source: {document}`. Cite every step and value with the passage `id` and the exact words (`quote`), copied, not paraphrased.
3. Where the source is unclear (it contradicts itself, says "about", leaves a speed or time out), add an open question with the `passages` involved and your `suggestion`. Don't pick silently.
4. Run `sops.check_citations`. Fix every `not_found` quote (copy the source's words) and every `found_elsewhere` one (cite the passage it names in `foundIn`), then check again.
5. Run `sops.review` (`{sop, expectedVersion}`) to have the reviewer check the draft against the source, then read what it changed with `sops.reviews` and tell the person.
6. Check `records.readiness` and tell the person what is open. Only a person answers questions (`sops.answer_question`, with `answer` or `acceptSuggestion: true`) and confirms sections.

`library.read` with `passages: [id, …]` reads cited passages back by id.

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
