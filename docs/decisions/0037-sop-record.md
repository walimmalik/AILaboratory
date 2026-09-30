# 0037: The digital SOP record

- Status: accepted
- Date: 2026-09-30
- Plan: 012 (G1, G2, G4 to G8)

## Context

Plan 012 chose our own schema with fixed sections (G1), steps as typed actions with a manual fallback (G2), materials by role bound later (G4), run inputs as variables (G5), open questions that block confirm (G6), derived SOPs instead of inheritance (G7) and no nesting, with steps stating what goes in and comes out (G8). This ADR records the shape those choices take.

## Decision

A `sop` record kind (`sop_`, `SOP-0001`) with attributes in `packages/schema/src/sops.ts`, confirmed in eight sections: overview, materials, variables, procedure, plate layout, analysis, timing and open questions.

- **Materials** are roles (`coating_plate`) with a type (reagent, entity, labware, instrument, consumable, solution), requirements in words and an optional default record. **Solutions** to prepare are roles too, with how to make them and an optional lab-made product.
- **Variables** have a kind: `input` (per run, with an optional default and bounds), `default`, `record` (read from a material's field once bound, with a typical value until then) and `computed` (a formula, ADR 0036, with the unit of its result).
- **Steps** have an id, an action (add, transfer, serial_dilute, mix, wash, incubate, shake, spin, seal, peel, read, image, wait, make_solution, manual), the step in plain lab words, the roles they use, what they produce (new roles later steps can use), parameters (each a quantity, a number, a variable or words), a repeat count, a group and an optional prerequisite SOP.
- **Plate layout** is a spec (standards, samples, blanks, controls with counts and replicates as numbers or variables), not a well map.
- **Timing** rules constrain a step against the end of another (min, max, target and tolerance), each with its source and whether the scheduler enforces it.
- **Open questions** name what they are about, suggest an answer and cite passages; answered ones carry the answer.
- Materials, variables, steps, layout, timing and questions can **cite** library passages (document, passage, page, quote); an SOP can name the document it was **digitized from** and the SOP it is **derived from**.
- **Writes are refused** when names repeat, a step uses an unknown role, a parameter or layout names an unknown variable, timing or a question names an unknown step, a unit is unknown, or a linked record isn't in the lab.
- **Readiness**: blockers for no steps, formulas that don't work out (waiting on a per-run input is fine), timing windows that aren't times and open questions; a warning for steps without a citation when the SOP has a source.
- **Operations**: `sops.draft` (direct for agents; a person confirms section by section) and `sops.calculate`, a calculator that works out an SOP's variables for a run from its defaults, typical values and the inputs given.

## Consequences

- Binding roles to records and reading record variables (012b) fill in values the schema already names.
- The digitizer (012c) writes this shape and the benchmark compares it section by section.
- Editing uses `records.update` like any record; a confirmed SOP changes only through a new version.
