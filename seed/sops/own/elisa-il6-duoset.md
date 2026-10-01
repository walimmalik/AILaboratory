---
key: sop-elisa-il6
title: Human IL-6 sandwich ELISA (DuoSet), 96-well
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.rndsystems.com/products/human-il-6-duoset-elisa_dy206
uses:
  labware: [thermo-442404]
  reagents: [rnd-dy206, rnd-dy008b]
  instruments: [bluecatbio-bluewasher, tecan-spark-cyto]
variables:
  capture_ab_working_conc: { value: "2", unit: "ug/mL", note: "Lot-specific, read from the kit's CoA" }
  detection_ab_working_conc: { value: "50", unit: "ng/mL", note: "Lot-specific, read from the kit's CoA" }
  standard_top_conc: { value: "600", unit: "pg/mL" }
  standard_points: 7
  standard_dilution_factor: 2
  well_volume: { value: "100", unit: "uL" }
  sample_dilution: 1
status_of_values:
  capture_ab_working_conc: estimated
  detection_ab_working_conc: estimated
  standard_top_conc: estimated
notes: Values follow the DuoSet general protocol from memory of the vendor sheet and must be checked against the kit insert and CoA before use.
actions: [add, wash, add, serial_dilute, add, add, add, add, read]
---

# Human IL-6 sandwich ELISA (DuoSet), 96-well

## Before you start
- Bring reagent diluent, standards and samples to room temperature.
- Make wash buffer (0.05% Tween 20 in PBS) and reagent diluent (1% BSA in PBS), or use the DuoSet Ancillary Reagent Kit 2.

## Steps
1. **Coat.** Dilute capture antibody to `capture_ab_working_conc` in PBS. Add `well_volume` per well to a MaxiSorp plate. Seal and incubate overnight at room temperature.
2. **Wash.** Wash 3 times with 400 µL wash buffer per well (BlueWasher). Remove all liquid after the last wash.
3. **Block.** Add 300 µL reagent diluent per well. Incubate at least 1 h at room temperature. Wash as in step 2.
4. **Standards and samples.** Dilute samples `sample_dilution`-fold in reagent diluent. Make a `standard_points`-point, `standard_dilution_factor`-fold series from `standard_top_conc` in reagent diluent, plus a blank. Add `well_volume` of standard or sample per well, in duplicate. Seal and incubate 2 h at room temperature. Wash.
5. **Detection antibody.** Dilute to `detection_ab_working_conc` in reagent diluent. Add `well_volume` per well. Seal and incubate 2 h at room temperature. Wash.
6. **Streptavidin-HRP.** Dilute as stated on the vial (typically 1:40). Add `well_volume` per well. Incubate 20 min at room temperature, **away from light**. Wash.
7. **Substrate.** Add `well_volume` TMB substrate per well. Incubate 20 min at room temperature, **away from light**.
8. **Stop.** Add 50 µL stop solution (2 N H2SO4) per well. Tap to mix.
9. **Read** absorbance at 450 nm with wavelength correction at 540 or 570 nm, **within 30 min of stopping**.

## Analysis
Subtract the correction reading, then the blank. Fit a four-parameter logistic curve to the standards and read samples off it, multiplying by any sample dilution.

## Timing rules (for the scheduler)
- Steps 6 and 7 are light sensitive.
- Read within 30 min of step 8 (vendor).
