---
key: sop-gibson-assembly
title: Gibson / NEBuilder HiFi assembly
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.neb.com/en-us/products/e2621-nebuilder-hifi-dna-assembly-master-mix
uses:
  reagents: [neb-e2621, neb-m0492, neb-c2987]
  instruments: [biorad-c1000-touch]
variables:
  total_dna: { value: "0.1", unit: pmol }
  vector_insert_ratio: "1:2"
  reaction_volume: { value: "20", unit: "uL" }
  master_mix_volume: { value: "10", unit: "uL" }
  incubation_temp: { value: "50", unit: degC }
  incubation_time: { value: "15", unit: min }
status_of_values:
  total_dna: estimated
notes: Use 60 min instead of 15 min for 4 or more fragments. Check amounts against the current NEB manual.
---

# Gibson / NEBuilder HiFi assembly

1. Amplify fragments with Q5 master mix, with 20–30 bp overlaps. Check on a gel; column-purify or DpnI-treat if the template was a plasmid.
2. Measure DNA (Qubit) and work out pmol from length.
3. On ice: vector and inserts at `vector_insert_ratio` (vector:insert, molar), `total_dna` in total, water to 10 µL, then `master_mix_volume` master mix, for `reaction_volume`.
4. Incubate at `incubation_temp` for `incubation_time` in the thermocycler, then hold on ice.
5. Transform 2 µL into NEB 5-alpha (`sop-transformation-miniprep`).
