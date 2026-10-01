---
key: sop-cell-seeding-384
title: Seeding HEK293 cells into 384-well assay plates (Mantis)
version: 1
origin: own
status: draft
drafted_by: agent
uses:
  labware: [corning-3570]
  reagents: [gibco-11965092, gibco-a5256701, gibco-15140122, gibco-12604013]
  entities: [atcc-crl-1573]
  instruments: [formulatrix-mantis, thermo-cytomat-10]
variables:
  cells_per_well: { value: "1500", unit: cells }
  seeding_volume: { value: "25", unit: "uL" }
  incubation_time: { value: "48", unit: h }
status_of_values:
  cells_per_well: lab_convention
  incubation_time: lab_convention
actions: [manual, make_solution, add, wait, incubate]
---

# Seeding HEK293 cells into 384-well assay plates

1. Detach cells from a flask at 70–90% confluence with TrypLE Express (see `sop-hek293-passaging`), count, and check viability is above 90%.
2. Dilute in complete medium to `cells_per_well` per `seeding_volume` (60,000 cells/mL for the defaults).
3. Dispense `seeding_volume` per well with the Mantis (high-volume chip), onto the assay-ready plate. Keep the suspension mixed; re-mix every 5 min.
4. Leave plates 20–30 min at room temperature before moving them to the incubator, to reduce edge effects.
5. Incubate in the Cytomat at 37 °C, 5% CO2 for `incubation_time`.

## Handling rules
- Live cells: at most 30 min out of the incubator per step (lab convention).
