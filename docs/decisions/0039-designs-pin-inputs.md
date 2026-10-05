# 0039: Designs pin their inputs by id and version

- Status: accepted
- Date: 2026-09-30
- Plan: 013 (E5, E8), and every design after it (014, 016, 017, 018, 019, 020)

> Planned refinement (2026-10-05): [ADR 0069](0069-working-methods-and-scientific-uncertainty.md) preserves the last valid accepted method while an incomplete working revision is edited. Historical attribution remains; an active flag alone will not establish future scientific eligibility. This refinement is accepted but not implemented.

## Context

The architecture review of Codex's PR #62 found that designs point at their inputs by id alone. A confirmed experiment that follows "the ELISA SOP" silently changes when someone edits that SOP from 100 µL to 50 µL of detection antibody, so a design a person signed off on changes under them. Wali agreed on 2026-09-30 that designs pin `{id, version}` of their inputs. He also decided that "active" means a person has signed off (their own edit to an active record counts as confirming it; an agent's edit is a proposal), so there is no separate "confirmed" status to track.

## Options

1. Point at inputs by id and read their current values: simple, but a confirmed design follows every later edit.
2. Pin `{id, version}` and read the values at that version; a newer confirmed version is shown and adopted only when someone chooses to.
3. Copy the inputs' values into the design: self-contained, but loses the link to where they came from and duplicates every SOP into every experiment.

## Decision

Option 2.

- **What is pinned.** Scientific definitions a design is built on: digital SOPs (013), and from 013b the labware types, products and lots its roles bind to, then plate maps, transfer plans and workflows as they reference each other. A pin is `{id, version}` (`pinOf` in `packages/schema/src/design.ts`). Physical state is not pinned: volumes, container contents, reservations and instrument availability are checked live when a run is planned or started.
- **Which versions may be pinned.** A version at which the record was active, meaning a person confirmed it. A pin to a version that doesn't exist or to a record of another kind refuses the write. A pin to a version that was never confirmed is a readiness blocker, so an agent can draft against a draft SOP but nothing gets planned on it.
- **Newer versions.** When the record is active at a later version whose attributes differ from the pinned ones, readiness shows a warning ("SOP-0004 v7, this uses v3") with a one-click fix (`experiments.adopt_versions` for experiments) that moves every pin to the latest confirmed version. Nothing moves on its own. A label change or a section confirmation alone is not a newer version.
- **Runs** pin the experiment version they follow, so "which runs followed SOP-0004 v3" is answered through the design version each run ran (`experiments.where_used`).
- **How kinds check pins.** The record service gives a kind's `related` rules `getVersion(id, version)`, the record as it was at a version in the same lab. `checkPin` in `apps/api/src/records/pins.ts` is the shared check every design kind uses.

## Consequences

- A confirmed design means what it meant when it was confirmed, and history shows when it adopted a newer SOP and who did it.
- Every design kind must check its pins with `checkPin` and offer an adopt operation; readiness reads version snapshots, which costs a lookup per pin.
- Record links still point at the record id (the `follows` link), so "what uses SOP-0004" stays a link query; filtering by version reads the pinned attributes.
