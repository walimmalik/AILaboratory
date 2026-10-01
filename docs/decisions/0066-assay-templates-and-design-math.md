# 0066: Assay templates are records; design math is pure

- Status: accepted
- Date: 2026-10-01
- Plan: 017

## Context

Plan 017 (D1 to D7, accepted by Wali 2026-09-29) makes the lab's assays ready-made designers: "run an IL-6 ELISA on these 40 supernatants" should become a complete, checked design in one ask. Labs add assays all the time and agents must be able to add them (rule 2), so a template can't be code. The designer must ask only what a template marks as essential, fit the template to whatever instruments the lab has today, and show the totals (plates, wells, runs) before anything is confirmed.

## Options

1. Templates in code, one per assay: fast to write, but agents can't add one and the lab can't change one.
2. A template record with free-text sections: agents can draft it, but nothing downstream can compute from it.
3. A typed template record (`asy_`, `ASY-0001`) with pinned SOP versions, roles as capabilities, essential inputs, factors and levels, control and replicate rules with reasons, readouts by capability, quality criteria; the combinatorics and totals as pure functions.

## Decision

Option 3 (D1). `AssayTemplateAttributes` (`packages/schema/src/assays.ts`):

- **Parts** pin confirmed digital SOP versions (ADR 0039).
- **Roles** name a capability with preferred instruments, or a default record (D4). They never name a single instrument as a requirement.
- **Essentials** are the subjects or an SOP input variable, and nothing else (D3).
- **Factors** have levels, which are listed, come from an essential input, or come from a concentration series. The design is full factorial or one factor at a time (D5).
- **Controls** are wells of a role per plate or per run, each with its reason. **Replicates** are technical wells per condition and biological runs, also with reasons (D6).
- **Readouts** are a capability with settings. Reader files wait for the device gateway (022).
- **Quality criteria** are a measure, a comparison and a threshold, per plate, run or experiment, computed by 020.

`packages/domain/src/design.ts` holds the design math:
- `seriesLevels` turns a concentration series into levels.
- `designConditions` makes the conditions: every combination in a full factorial (capped at 20,000 conditions), or the baseline then each factor varied alone.
- `designTotals` gives subject and control wells, plates per run (as few as fit with per-plate controls), runs and totals, each as a line in lab words.

## Consequences

- Agents can draft, and people can confirm, a new assay through the same record (D2). No block editor is needed.
- The designer (017b) fills an experiment from a confirmed template version and binds roles with 016's deterministic tools, so a template survives an instrument going down.
- Totals here are the design's own arithmetic. They count wells and plates only. Reagent volumes against stock and instrument time come from 016's calculators and the SOP's formulas in the feasibility check (017b). Power analysis waits for 020.
- Fractional factorial and response-surface designs come later through the science service (017d), and they add a `DesignKind` without changing the factor shape.
