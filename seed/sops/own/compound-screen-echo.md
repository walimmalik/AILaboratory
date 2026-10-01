---
key: sop-compound-screen
title: Compound screen, single point and dose-response follow-up (Echo 650, 384-well)
version: 1
origin: own
status: draft
drafted_by: agent
uses:
  labware: [beckman-001-14555, beckman-001-12782, corning-3570]
  reagents: [sigma-d2650, cayman-81590]
  instruments: [echo-650, formulatrix-mantis, thermo-cytomat-10, highres-lidvalet]
variables:
  stock_conc: { value: "10", unit: "mM" }
  single_point_conc: { value: "10", unit: "uM" }
  dr_top_conc: { value: "10", unit: "uM" }
  dr_points: 10
  dr_dilution_factor: 3
  assay_volume: { value: "25", unit: "uL" }
  max_dmso: { value: "0.1", unit: "%v/v" }
  positive_control_conc: { value: "1", unit: "uM" }
status_of_values:
  single_point_conc: lab_convention
  dr_top_conc: lab_convention
  assay_volume: lab_convention
  max_dmso: lab_convention
  positive_control_conc: lab_convention
actions: [manual, transfer, manual, transfer, manual, manual, serial_dilute, transfer, manual]
---

# Compound screen, single point and dose-response follow-up

Compounds are dispensed into empty assay plates with the Echo ("assay-ready plates"); cells are added on top (see `sop-cell-seeding-384`), then read with CellTiter-Glo (`sop-celltiter-glo`) or HiBiT (`sop-hibit-lytic`).

## Source plate
1. Thaw compound stocks (`stock_conc` in DMSO) at room temperature, spin briefly.
2. Transfer to an Echo 384PP source plate (or 384LDV for small volumes) within the plate's working volume range. Seal and spin 1 min at 1000 x g to clear bubbles.
3. DMSO takes up water from air: keep source plates sealed when not on the Echo, and survey the plate before each run.

## Single-point screen
1. One compound per well at `single_point_conc` final in `assay_volume`, so each well gets 25 nL of 10 mM stock (0.1% DMSO).
2. Controls on every plate: columns 1–2 DMSO only (neutral, 16 wells each), columns 23–24 staurosporine at `positive_control_conc` (positive; 25 nL of the 1 mM stock).
3. Hits: activity beyond 3 standard deviations of the neutral controls, or the lab's set cut-off.

## Dose-response follow-up
1. For each hit, a `dr_points`-point, `dr_dilution_factor`-fold series from `dr_top_conc`, in duplicate.
2. Back-fill with DMSO so every well has the same DMSO (at most `max_dmso`).
3. Same controls as above.

## Plate handling
- Assay-ready plates can be sealed and stored at -20 °C (lab convention: use within 1 month).
- Record the Echo transfer log with the plate; failed transfers (surveyed volume too low) flag the well.
