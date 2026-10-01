---
key: sop-hek293-passaging
title: HEK293 routine passaging
version: 1
origin: own
status: draft
drafted_by: agent
based_on:
  - https://www.atcc.org/products/crl-1573
uses:
  reagents: [gibco-11965092, gibco-a5256701, gibco-15140122, gibco-12604013, gibco-14190144]
  entities: [atcc-crl-1573]
variables:
  split_ratio: "1:5 to 1:10"
  confluence_at_split: "70-90%"
  trypsin_time: { value: "5", unit: min }
actions: [manual, manual, wash, add, mix, transfer]
---

# HEK293 routine passaging

BSL-2. Work in the biosafety cabinet.

1. Warm complete medium (DMEM high glucose, 10% FBS, 1% Pen-Strep) to 37 °C.
2. Check the flask: `confluence_at_split`, normal morphology, no contamination.
3. Remove medium, rinse gently with DPBS (HEK293 detach easily).
4. Add TrypLE Express (1 mL per T25, 3 mL per T75), 37 °C for up to `trypsin_time`.
5. Add complete medium, pipette to single cells, count.
6. Seed new flasks at `split_ratio`. Record the passage number; retire cultures after the lab's passage limit.

## Handling rules
- Live cells: at most 30 min out of the incubator (lab convention).
