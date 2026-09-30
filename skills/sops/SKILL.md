---
name: ailab-sops
description: Work with digital SOPs in AILaboratory through its MCP tools; so far, working out SOP formulas (volumes, totals, dilutions) with units and exact decimals.
---

# Digital SOPs in AILaboratory

A digital SOP (plan 012) is a lab procedure as a structured document: materials by role, typed steps, and variables. Variables are inputs per run (samples, replicates), defaults (well volume), values read from records (a plate's dead volume) or formulas over the others. 

## Drafting an SOP

- `sops.draft` with `label` and the sections: `materials` (roles like `coating_plate` with `type`, `requirements` and a `default` record id when you know it), `solutions`, `variables`, `steps`, `layout`, `timing`, `questions`, plus `purpose`, `assays` and `source: {document}` when you work from a library document.
- Steps: `{id: "coat", action: "add", text: "…in plain lab words…", uses: ["coating_plate", "capture_ab"], parameters: [{name: "volume", variable: "well_volume"}], produces: [{role: "coated_plate", label: "Coated plate"}]}`. Use `manual` for anything the other actions don't fit; `repeat: 3` for "wash 3 times".
- Variables: `input` for what each run chooses (samples, replicates), `default` for usual values, `record` for values read from a bound material (`readFrom: {role, field}`, with the typical value as `value`), `computed` with an `expression`.
- Cite the passage for every step and value (`cite: [{document, passage, page, quote}]`), and put anything the source leaves unclear in `questions` with your suggestion rather than guessing. Mark your own estimates assumed in `evidence`.
- Check `records.readiness`: open questions, broken formulas and timing that isn't a time block confirming.
- `sops.calculate` with `{sop, inputs: [{name: "n_samples", value: "24"}]}` gives every variable for a run and where it came from.

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
