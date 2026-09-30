# 0044: Transfer plans and soft reservations

- Status: accepted
- Date: 2026-09-30
- Plan: 016

## Context

Plan 016 (T1, T2, P5, P6) and 010 V8 fix what a transfer plan is: plates plus groups of concrete transfers, each group one method on one instrument with the agent's reason, checked by code, confirmed by a person, and soft-reserving what it draws. Three things were left to the build: how a plan names plates that don't exist yet, how readiness checks volumes against instruments when the kind's `related` hook can only read records, and where reservations live when each module owns its tables.

## Options

1. Transfers address real containers only: destination and intermediate plates would have to be registered before a plan could be drafted, which is backwards (they are made when the plan runs).
2. Transfers address the plan's own plates by a short name (`src`, `assay1`); each plate has a pinned labware type and, once known, a container or a plate map plate.

For volumes against instruments:

1. Resolve the instrument inside `related` by importing the instruments module's resolver.
2. Copy the device limits into the group when an operation sets the instrument, check volumes against that copy in readiness, and compare it with the instrument now in `transfers.check`.

For reservations:

1. A reservations table in inventory, written when a plan is confirmed.
2. Derive them from confirmed transfer plans: what each active plan draws from real source containers.

## Decision

Option 2 in each case.

- Plates are named in the plan, with role source, destination or intermediate. Sources get their container on the day (`transfers.pick_sources`, P5); new plates get theirs when made.
- `transfers.draft` and `transfers.set_instrument` copy the instrument's transfer or dispense limits into the group (`device`). Readiness checks every volume against that copy; `transfers.check` adds what is live: instruments now, and source wells against what they hold less other plans' reservations.
- A plan reserves while it is confirmed (status active): what it draws from each source container well. Archiving it ends its reservations; from 016b, recording its run does too. Over-committing is a warning (V8).

## Consequences

- The plan records what it was worked out against, which is also its provenance. A changed instrument shows up in `transfers.check`, not silently in readiness.
- No new table and nothing to keep in step: a reservation can't outlive its plan. `transfers.reserved` and `transfers.source_volumes` read them.
- Readiness can't see live stock; `transfers.check` is the full check, and the transfer plan page (016d) shows both.
