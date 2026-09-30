---
name: ailab-sops
description: Work with digital SOPs in AILaboratory through its MCP tools; so far, working out SOP formulas (volumes, totals, dilutions) with units and exact decimals.
---

# Digital SOPs in AILaboratory

A digital SOP (plan 012) is a lab procedure as a structured document: materials by role, typed steps, and variables. Variables are inputs per run (samples, replicates), defaults (well volume), values read from records (a plate's dead volume) or formulas over the others. The SOP record itself comes next; formulas work now.

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
