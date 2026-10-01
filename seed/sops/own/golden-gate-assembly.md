---
key: sop-golden-gate-assembly
title: Golden Gate assembly (BsaI-HFv2)
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.neb.com/en-us/products/e1601-neb-golden-gate-assembly-kit-bsai-hf-v2
uses:
  reagents: [neb-e1601, neb-c2987]
  instruments: [biorad-ptc-tempo]
variables:
  destination_vector: { value: "75", unit: ng }
  insert_to_vector_ratio: 2
  reaction_volume: { value: "20", unit: "uL" }
  cycles: 30
status_of_values:
  destination_vector: estimated
notes: Check amounts and cycling against the current NEB manual. Single-insert assemblies can use 37 °C for 60 min instead of cycling.
actions: [manual, make_solution, incubate, manual]
---

# Golden Gate assembly (BsaI-HFv2)

1. Design parts with BsaI sites and unique 4 nt overhangs; check no internal BsaI sites remain.
2. On ice: `destination_vector` destination plasmid, each insert at `insert_to_vector_ratio`:1 molar to the vector, 2 µL T4 DNA ligase buffer, 1 µL Golden Gate enzyme mix, water to `reaction_volume`.
3. Thermocycle: (37 °C 1 min, 16 °C 1 min) × `cycles`, then 60 °C 5 min.
4. Transform 2 µL into NEB 5-alpha (`sop-transformation-miniprep`).
