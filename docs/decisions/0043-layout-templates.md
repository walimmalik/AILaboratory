# 0043: Layout templates are records the placement rules read

- Status: accepted
- Date: 2026-09-30
- Plan: 014

## Context

Plan 014 locked P1 to P6 and M1 to M6 (all A): a layout template is the lab's reusable plate pattern for one format (M4), a dilution series is one object (M2), controls repeat on every plate (M3), every placement strategy keeps its seed (M1), and wells carry analysis groups (M6). 014a-1 built the placement rules in `packages/domain/src/platemap.ts`. The layout needs a record that holds exactly what those rules read, so a draft that can't work on its plate is refused before a person reviews it.

## Options

1. A layout record whose attributes are the placement rules' input in lab words (regions like "columns 1-2"), checked by running the rules on every write: a layout that can't place one subject is refused with the rules' own reason.
2. A layout that stores the expanded wells: nothing to compute, but every consumer re-derives regions and series from wells, and a change to one region means rewriting the grid.

## Decision

Option 1. `layout` (`lyt_`, `LYT-0001`) holds the format by well count, the subject role, region and single-point concentration or series, fixed regions (controls, blanks, a standard series, optionally a standing control record), replicates and arrangement, fill order, strategy, edges, leftovers, well volume and analysis groups. Its `related` hook runs `generatePlateMap` with one subject and refuses what the rules refuse; a layout without controls or standards gets a warning, not a blocker. It never names samples: a plate map (014a-3) applies it.

`layouts.draft` is direct for agents (drafts are agents' to fill); changes and confirmation go through the record operations like every design. `layouts.preview` is a calculator (ADR 0024): for a layout and a number of subjects, how many fit on a plate, how many plates and every planned well, so an agent never counts wells itself.

## Consequences

- One reading of regions and series: the domain rules. The web editor (014b), plate maps (014a-3), transfer plans (016) and analysis (020) all read the same layout.
- A layout is for one plate format; another format is a new layout (M4).
- The seed's five layouts come from `seed/assays.yaml` (`seed/layouts.yaml`), marked as stated lab conventions.
