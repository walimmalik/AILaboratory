# 0031: Well contents as components with concentrations, mixed exactly

- Status: accepted
- Date: 2026-09-30
- Plan: 010

## Context

Plan 010, V2 to V4 (accepted by Wali on 2026-09-29, all A): a well lists its components (samples and lots) with amount and concentration, recomputed by mixing math on every transfer; a volume can't go below zero; "unknown" is allowed. Dose-response needs the final concentration per well, and 009 R8 computes a well's liquid type from its contents (0.5 % DMSO). ADR 0024 makes the mixing math a calculator agents call.

## Options

1. Each component carries its concentration in the unit it came in (mM, ng/µL, U/mL, cells/mL, % v/v); mixing converts to amounts, adds them, and divides by the new volume. Dry wells carry amounts.
2. Each component carries an amount only; concentrations are computed when read. Reads of a 384-well plate would recompute everything, and a stock of known concentration but unknown volume could not be recorded.
3. Store volume fractions of each source well and compute concentrations from lineage. Exact, but every read walks the lineage.

## Decision

Option 1.

- `WellState` = `{volume, components, assumed?}`. `volume` is a liquid volume or `"unknown"`. A component is `{source, concentration?}` in a liquid or `{source, amount?}` in a dry well. `source` is a sample (`smp_`) or a lot (`lot_`) (V2).
- Mixing (`@ailab/domain` contents.ts): every concentration per volume mixes linearly. Each dimension has a base unit and an amount per litre: molar (mol), mass (g), activity (U), cells, colonies, % v/v (volume) and % w/v (mass). The same source in the same dimension adds up, and the result keeps the component's unit. A dry amount dissolves into µM, µg/mL, U/mL, cells/mL or CFU/mL. Exact decimals throughout (40 significant digits, ADR 0010).
- Unknowns stay unknown: an unknown well volume, a component without a concentration, or `%w/w` (which doesn't mix by volume) all give "present, concentration unknown". `%w/w` into an empty well keeps its value.
- Taking more than a well holds is refused. Taking from a well of unknown volume is allowed and leaves it unknown.
- Estimated contents carry `assumed`, and it follows the liquid into every well it reaches.
- `inventory.calculate_transfer` exposes the math as a calculator. `skills/calculators` lists the calculators so far.

## Consequences

- The ledger (next 010c step) stores each well's state after every change, plus the entry that changed it. Lineage comes from the entries, not the state.
- Concentrations after deep dilutions have long exact decimals; the UI rounds for display only.
- Mixing volumes are assumed additive (no contraction, e.g. ethanol and water). This is noted in the calculator's explanation when it matters, and never claimed physically exact.
