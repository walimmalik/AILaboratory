---
key: sop-hibit-lytic
title: Nano-Glo HiBiT lytic readout, 384-well
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.promega.com/products/protein-detection/protein-quantitation/nano-glo-hibit-lytic-detection-system/
uses:
  reagents: [promega-n3040]
  instruments: [tecan-spark-cyto, formulatrix-mantis]
variables:
  medium_volume: { value: "25", unit: "uL" }
  reagent_volume: { value: "25", unit: "uL" }
  lgbit_dilution: 100
  substrate_dilution: 50
  signal_incubation: { value: "10", unit: min }
actions: [make_solution, wait, add, incubate, read]
---

# Nano-Glo HiBiT lytic readout

Used instead of CellTiter-Glo when the target protein carries a HiBiT tag, to measure its level (for example degradation by a compound).

1. Make the detection reagent just before use: lytic buffer with LgBiT protein 1:`lgbit_dilution` and substrate 1:`substrate_dilution`. Use it the same day.
2. Bring plates to room temperature.
3. Add `reagent_volume` per well (equal to `medium_volume`) with the Mantis. Shake 2 min.
4. Incubate `signal_incubation` at room temperature.
5. Read luminescence on the Spark Cyto.
