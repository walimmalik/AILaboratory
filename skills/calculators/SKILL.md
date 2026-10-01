---
name: ailab-calculators
description: The lab calculators in AILaboratory, deterministic tools for volumes, concentrations and amounts. Use them instead of your own arithmetic whenever a number goes into a design or a record.
---

# Lab calculators

Volumes, concentrations, dilutions and amounts come from a calculator, never from your own arithmetic (ADR 0024). Calculators are read operations: they change nothing, so call them freely to explore before drafting. When you put a calculator's result into a draft, mark it calculated with the `calculation` handle that came back with the result (`{"source": "calculated", "calculation": "calc_…", "output": "/volume"}`); the record service refuses a value the calculation did not give. Inside a change set, a calculator step's handle is `"$N.calculation"`. If no calculator covers a number you need, say so and mark your figure assumed.

| Calculator | Use it for | Input |
| --- | --- | --- |
| `inventory.calculate_transfer` | What two wells hold after moving a volume: volumes left, every component's concentration after mixing, dry amounts dissolving | `{source: WellState, destination?: WellState, volume}` |
| `inventory.map_plates` | Which source well lands on which destination well when stamping (one to one, quadrant, offset) | `{from, to, mapping, wells?}` |
| `layouts.preview` | How many subjects fit on a plate with a layout, how many plates they need, and every planned well | `{layout or attributes, subjects, seed?}` |
| `transfers.dilution_options` | Whether each target concentration is reached straight from a stock with a device, or through a 10, 100 or 1000 fold intermediate: volume, droplets, achieved concentration and error, solvent | `{stock, targets, finalVolume, device, maxSolventPercent?, tolerance?}` |
| `transfers.optimize_dilution` | The dilution optimizer: for many compounds and curve points, which come from the source plate and which from intermediate wells, with the fewest intermediate wells and plates | `{compounds, finalVolume, device, maxSolventPercent, intermediatePlate, tolerance?}` |
| `transfers.source_volumes` | What each source well must hold for a set of draws (drawn + dead volume + overage) and which wells are short | `{draws: [{container, well, volume}], overage?}` |
| `transfers.check` | Every rule on a transfer plan as things stand today: volumes against instrument limits, instruments ready, what each source well must hold against what it holds less other plans' reservations, destination capacity, pinned plate maps and labware current | `{id}` |
| `transfers.options` | Every instrument in the lab that could move a volume, best first, with the volume it really moves, its liquid class and tips | `{volume, liquid?, wells?}` |
| `reagents.scale_recipe` | How much of each component a lab-made product needs for a batch | `{product, target}` |
| `sops.evaluate` | Formulas over named values with units, as SOP variables use them: totals with dead volume, C1V1, rounding up to a tube size | `{variables: [{name, value} or {name, expression, unit?}]}` |
| `sops.calculate` | Every value an SOP needs for one run: binds its material roles to records, reads their values (a lot's certificate value, a plate's dead volume), takes the run's inputs and computes the formulas, saying where each came from and what is missing | `{sop, version?, bindings?, inputs?}` |
| `sops.score` | How well a digitized SOP matches what its source must contain: materials, steps, values and questions found, what is missing | `{sop, expected: SopExpectation}` |
| `experiments.calculate` | Every value an experiment's protocol needs, from the SOP versions and records it pinned and its inputs, with what is missing | `{id}` |
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
