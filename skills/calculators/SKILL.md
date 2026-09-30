---
name: ailab-calculators
description: The lab calculators in AILaboratory, deterministic tools for volumes, concentrations and amounts. Use them instead of your own arithmetic whenever a number goes into a design or a record.
---

# Lab calculators

Volumes, concentrations, dilutions and amounts come from a calculator, never from your own arithmetic (ADR 0024). Calculators are read operations: they change nothing, so call them freely to explore before drafting. When you put a calculator's result into a draft, say it was calculated and by which operation. If no calculator covers a number you need, say so and mark your figure assumed.

| Calculator | Use it for | Input |
| --- | --- | --- |
| `inventory.calculate_transfer` | What two wells hold after moving a volume: volumes left, every component's concentration after mixing, dry amounts dissolving | `{source: WellState, destination?: WellState, volume}` |
| `inventory.map_plates` | Which source well lands on which destination well when stamping (one to one, quadrant, offset) | `{from, to, mapping, wells?}` |
| `reagents.scale_recipe` | How much of each component a lab-made product needs for a batch | `{product, target}` |
| `sops.evaluate` | Formulas over named values with units, as SOP variables use them: totals with dead volume, C1V1, rounding up to a tube size | `{variables: [{name, value} or {name, expression, unit?}]}` |
| `liquids.resolve_class` | Which liquid class a transfer uses, and why | `{liquid, instrumentKind, device?, tip?, sourceLabware?, mode?, volume}` |

A `WellState` is `{volume: {"value": "25", "unit": "uL"} or "unknown", components: [{source: "lot_…" or "smp_…", concentration?} or {source, amount?}]}`. Concentrations can be molar (`mM`), mass (`ng/uL`), activity (`U/mL`), cells or colonies per volume, `%v/v` or `%w/v`; those all mix. `%w/w` doesn't mix by volume and becomes unknown once mixed. A component without a concentration is present but unmeasured, and stays unknown.

Example: 25 nL of a 10 mM stock in DMSO into 25 µL of medium:

```json
{"source": {"volume": {"value": "40", "unit": "uL"}, "components": [
   {"source": "lot_…", "concentration": {"value": "10", "unit": "mM"}},
   {"source": "lot_…", "concentration": {"value": "100", "unit": "%v/v"}}]},
 "destination": {"volume": {"value": "25", "unit": "uL"}, "components": [
   {"source": "lot_…", "concentration": {"value": "100", "unit": "%v/v"}}]},
 "volume": {"value": "25", "unit": "nL"}}
```

It returns the compound at about 0.00999 mM and DMSO at about 0.0999 % v/v in 25.025 µL, with exact decimals; round only when you show them to a person.
