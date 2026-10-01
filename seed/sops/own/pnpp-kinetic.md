---
key: sop-pnpp-kinetic
title: Alkaline phosphatase kinetic screen (pNPP, absorbance 405 nm), 96-well
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.thermofisher.com/order/catalog/product/37620
uses:
  labware: [greiner-655101]
  reagents: [thermo-37620]
  entities: [enz-rsap]
  instruments: [tecan-spark-cyto, hamilton-star]
variables:
  enzyme_volume: { value: "50", unit: "uL" }
  substrate_volume: { value: "50", unit: "uL" }
  read_interval: { value: "30", unit: s }
  read_duration: { value: "20", unit: min }
  read_temperature: { value: "25", unit: degC }
  compound_conc: { value: "10", unit: uM }
status_of_values:
  enzyme_volume: lab_convention
  substrate_volume: lab_convention
  read_interval: lab_convention
  read_duration: lab_convention
  compound_conc: lab_convention
notes: Enzyme amount is set so the no-inhibitor wells stay linear for the whole read; titrate it once per enzyme lot.
actions: [make_solution, transfer, add, add, read]
---

# Alkaline phosphatase kinetic screen (pNPP)

Measures enzyme activity as the rate of p-nitrophenol formation (yellow, 405 nm), with and without test compounds.

1. Make pNPP substrate from the kit (tablets in the kit's diethanolamine buffer) just before use; protect from light.
2. Dispense compounds (Echo, `compound_conc` final) or buffer into a clear flat-bottom plate. Controls: no-enzyme wells (background) and enzyme with DMSO only (full activity).
3. Add `enzyme_volume` enzyme in assay buffer with the STAR; pre-incubate 10 min at `read_temperature`.
4. Put the plate in the Spark Cyto at `read_temperature`. Add `substrate_volume` substrate (reader injector or STAR) and start reading at once.
5. Read absorbance at 405 nm every `read_interval` for `read_duration`.

## Analysis
Slope of A405 against time over the linear part of each well (mOD/min), minus the no-enzyme slope. Percent activity against the DMSO controls; for follow-up, IC50 from a dose-response series.

## Timing rules (for the scheduler)
- Substrate is used within the hour it is made (lab convention).
- The first read starts within 1 min of adding substrate.
