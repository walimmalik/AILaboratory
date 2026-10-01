---
key: sop-celltiter-glo
title: CellTiter-Glo 2.0 viability readout, 384-well
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.promega.com/products/cell-health-assays/cell-viability-and-cytotoxicity-assays/celltiter_glo-2_0-assay/
uses:
  reagents: [promega-g9242]
  instruments: [tecan-spark-cyto, formulatrix-mantis]
variables:
  medium_volume: { value: "25", unit: "uL" }
  reagent_volume: { value: "25", unit: "uL" }
  equilibration_time: { value: "30", unit: min }
  signal_incubation: { value: "10", unit: min }
actions: [wait, add, shake, incubate, read]
---

# CellTiter-Glo 2.0 viability readout

1. Take plates out of the incubator and let plates and reagent reach room temperature (`equilibration_time`).
2. Add `reagent_volume` CellTiter-Glo 2.0 per well (equal to `medium_volume`) with the Mantis.
3. Shake 2 min to lyse.
4. Incubate `signal_incubation` at room temperature to stabilise the signal.
5. Read luminescence on the Spark Cyto (0.25–1 s per well).

## Analysis
Percent viability against the DMSO neutral control (100%) and the staurosporine positive control (0%). Dose-response: four-parameter fit, report IC50 with its confidence interval.
