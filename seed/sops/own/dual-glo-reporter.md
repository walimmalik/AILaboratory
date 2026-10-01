---
key: sop-dual-glo-reporter
title: Dual-Glo luciferase reporter assay (gene expression), 96/384-well
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.promega.com/products/luciferase-assays/reporter-assays/dual_glo-luciferase-assay-system/
uses:
  reagents: [promega-e2920]
  entities: [atcc-crl-1573]
  instruments: [tecan-spark-cyto, formulatrix-mantis]
variables:
  medium_volume: { value: "25", unit: "uL" }
  reagent_volume: { value: "25", unit: "uL" }
  stop_glo_volume: { value: "25", unit: "uL" }
  stop_glo_substrate_dilution: 100
  wait_before_read: { value: "10", unit: min }
  firefly_read_window: { value: "2", unit: h }
status_of_values:
  medium_volume: lab_convention
notes: Check volumes, dilutions and signal windows against the current Promega technical manual.
actions: [manual, wait, add, read, make_solution, add, read]
---

# Dual-Glo luciferase reporter assay

Measures a firefly luciferase reporter (the gene-expression readout) and a Renilla luciferase control (for transfection efficiency and cell number) in the same well.

1. Transfect cells with the firefly reporter plasmid and a constitutive Renilla control plasmid; treat as the experiment requires.
2. Bring plates and reagents to room temperature.
3. Add `reagent_volume` Dual-Glo Luciferase Reagent per well (equal to `medium_volume`). Wait at least `wait_before_read`.
4. Read firefly luminescence on the Spark Cyto, **within `firefly_read_window`** of step 3.
5. Make Stop & Glo reagent just before use: substrate 1:`stop_glo_substrate_dilution` in Stop & Glo buffer.
6. Add `stop_glo_volume` per well. Wait at least `wait_before_read`.
7. Read Renilla luminescence, within the same window.

## Analysis
Ratio firefly / Renilla per well, normalised to the untreated or empty-vector control.
