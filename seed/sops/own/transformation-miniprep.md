---
key: sop-transformation-miniprep
title: Transformation (NEB 5-alpha) and plasmid miniprep (QIAprep)
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.neb.com/en-us/products/c2987-neb-5-alpha-competent-e-coli-high-efficiency
  - https://www.qiagen.com/us/products/discovery-and-translational-research/dna-rna-purification/dna-purification/plasmid-dna/qiaprep-spin-miniprep-kit
uses:
  reagents: [neb-c2987, qiagen-27104]
variables:
  heat_shock_time: { value: "30", unit: s }
  heat_shock_temp: { value: "42", unit: degC }
  recovery_time: { value: "60", unit: min }
  culture_volume: { value: "5", unit: mL }
  elution_volume: { value: "50", unit: "uL" }
---

# Transformation and plasmid miniprep

## Transformation
1. Thaw a tube of NEB 5-alpha on ice (10 min). Add 1–5 µL assembly, flick, ice 30 min.
2. Heat shock at `heat_shock_temp` for exactly `heat_shock_time`. Ice 5 min.
3. Add 950 µL SOC, shake at 37 °C for `recovery_time` (250 rpm).
4. Plate 50–100 µL on LB with the selection antibiotic. Incubate overnight at 37 °C.

## Colony check and culture
1. Pick 2–4 colonies into `culture_volume` LB with antibiotic; grow 12–16 h at 37 °C, shaking.
2. Optional: colony PCR to screen before miniprep.

## Miniprep (QIAprep Spin)
1. Pellet 1–5 mL culture. Resuspend in 250 µL P1 (with RNase).
2. Add 250 µL P2, invert 4–6 times; do not exceed 5 min.
3. Add 350 µL N3, invert at once. Spin 10 min at about 17,900 x g.
4. Load the supernatant on the column, spin, discard. Wash with 0.75 mL PE, spin; spin again to dry.
5. Elute with `elution_volume` EB. Measure (Qubit or A260) and send for sequencing.
